let wasm = undefined;
let nextId = 1;
const invocations = {};

class Context {
    callbacks = {};
    ctx = undefined;

    constructor() {
        this.ctx = wasm._newContext();
    }

    dispose() {
        if (!this.ctx) {
            return; // already disposed
        }
        for (const { resolveFunc, rejectFunc } of Object.values(this.callbacks)) {
            if (resolveFunc) {
                wasm._freeJsValue(this.ctx, resolveFunc);
            }
            if (rejectFunc) {
                wasm._freeJsValue(this.ctx, rejectFunc);
            }
        }
        wasm._freeContext(this.ctx);
        this.ctx = undefined;
    }

    def(script, options) {
        if (!this.ctx) {
            throw new Error('context has been disposed');
        }
        return (...args) => {
            if (!this.ctx) {
                throw new Error('context has been disposed');
            }
            const key = `key${nextId++}`;
            const pScript = encodeString(wasm, `
            (() => {
                const __key = '${key}';
                const __args = ${JSON.stringify(args.map(arg => typeof arg === 'function' ? { __f__: true } : arg))};
                function dispatch(action, args) {
                    return __dispatch(action, __key, JSON.stringify(args));
                }
                function decodeArg(arg, i) {
                    // the argument is a function
                    if (arg && arg.__f__) {
                        return function(...args) {
                            return dispatch('invoke', {slot:i, args});
                        }
                    }
                    return arg;
                }
                function f() {
                    ${script}
                }
                try {
                    const result = f.apply(undefined, __args.map((arg, i) => decodeArg(arg, i)));
                    if (result && result.then && result.catch) {
                        result
                            .then(v => { dispatch('setSuccess', v); })
                            .catch(e => { dispatch('setFailure', '' + e); })
                    } else {
                        dispatch('setSuccess', result);
                    }
                } catch(e) {
                    dispatch('setFailure', "" + e);
                }
            })();
            `);
            const invocation = invocations[key] = new Invocation({ args, callbacks: this.callbacks, ctx: this.ctx}, options?.timeout);
            const pError = wasm._eval(this.ctx, pScript);
            if (pError) {
                throw new Error(decodePtrString(wasm, pError));
            }
            (async () => {
                try {
                    await invocation.asyncResult;
                } catch (e) {
                    // ignore
                } finally {
                    wasm._free(pScript);
                    delete invocations[key];
                }
            })();
            return invocation.syncResult();
        }
    }
}

class Invocation {

    asyncResult;
    syncResult;
    resolveAsyncResult;
    rejectAsyncResult;
    args;
    callbacks;
    ctx;

    constructor(init, timeout) {
        Object.assign(this, init);
        this.asyncResult = new Promise((resolve, reject) => {
            this.resolveAsyncResult = resolve;
            this.rejectAsyncResult = reject;
        });
        this.syncResult = () => {
            return Promise.race([this.asyncResult, (async () => {
                if (timeout) {
                    await new Promise(resolve => setTimeout(resolve, timeout));
                    throw new Error('execute function timeout');
                } else {
                    const noResult = this.syncResult;
                    while (this.syncResult === noResult) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            })()]);
        };
    }

    invoke(invokeArgs) {
        const invokeResult = this.args[invokeArgs.slot](...invokeArgs.args);
        if (invokeResult && invokeResult.then && invokeResult.catch) {
            const promiseId = `p${nextId++}`;
            const callback = this.callbacks[promiseId] = {
                promise: invokeResult,
                rejectFunc: 0, // will be filled by setPromiseCallbacks
                resolveFunc: 0, // will be filled by setPromiseCallbacks
            };
            invokeResult
                .then(v => {
                    if (!callback.resolveFunc) {
                        return;
                    }
                    const pError = wasm._call(this.ctx, callback.resolveFunc, encodeString(wasm, JSON.stringify(v)));
                    if (pError) {
                        this.setFailure(decodePtrString(wasm, pError));
                    } else {
                        wasm._freeJsValue(this.ctx, callback.resolveFunc);
                        callback.resolveFunc = 0;
                        wasm._freeJsValue(this.ctx, callback.rejectFunc);
                        callback.rejectFunc = 0;
                    }
                })
                .catch(e => {
                    if (!callback.rejectFunc) {
                        return;
                    }
                    const pError = wasm._call(this.ctx, callback.rejectFunc, encodeString(wasm, '' + e));
                    if (pError) {
                        this.setFailure(decodePtrString(wasm, pError));
                    } else {
                        wasm._freeJsValue(this.ctx, callback.resolveFunc);
                        callback.resolveFunc = 0;
                        wasm._freeJsValue(this.ctx, callback.rejectFunc);
                        callback.rejectFunc = 0;
                    }
                });
            return encodeString(wasm, promiseId);
        }
        // eval.c dispatch will free this memory
        return encodeString(wasm, JSON.stringify(invokeResult));
    }

    setPromiseCallbacks({ promiseId, rejectFunc, resolveFunc }) {
        this.callbacks[promiseId].resolveFunc = resolveFunc;
        this.callbacks[promiseId].rejectFunc = rejectFunc;
        return 0;
    }

    setSuccess(value) {
        this.syncResult = () => value;
        this.resolveAsyncResult(value);
        return 0;
    }

    setFailure(error) {
        this.syncResult = () => { throw new Error(error) };
        this.rejectAsyncResult(new Error(error));
        return 0;
    }
}

function encodeString(wasm, string) {
    if (string === undefined) {
        return undefined;
    }
    var octets = [];
    var length = string.length;
    var i = 0;
    while (i < length) {
        var codePoint = string.codePointAt(i);
        var c = 0;
        var bits = 0;
        if (codePoint <= 0x0000007F) {
            c = 0;
            bits = 0x00;
        } else if (codePoint <= 0x000007FF) {
            c = 6;
            bits = 0xC0;
        } else if (codePoint <= 0x0000FFFF) {
            c = 12;
            bits = 0xE0;
        } else if (codePoint <= 0x001FFFFF) {
            c = 18;
            bits = 0xF0;
        }
        octets.push(bits | (codePoint >> c));
        c -= 6;
        while (c >= 0) {
            octets.push(0x80 | ((codePoint >> c) & 0x3F));
            c -= 6;
        }
        i += codePoint >= 0x10000 ? 2 : 1;
    }
    octets.push(0);
    const ptr = wasm._malloc(octets.length);
    wasm.HEAP8.set(octets, ptr);
    return ptr;
}

function decodePtrString(wasm, ptr) {
    const octets = wasm.HEAP8.subarray(ptr);
    var string = "";
    var i = 0;
    while (i < octets.length) {
        var octet = octets[i];
        var bytesNeeded = 0;
        var codePoint = 0;
        if (octet <= 0x7F) {
            bytesNeeded = 0;
            codePoint = octet & 0xFF;
        } else if (octet <= 0xDF) {
            bytesNeeded = 1;
            codePoint = octet & 0x1F;
        } else if (octet <= 0xEF) {
            bytesNeeded = 2;
            codePoint = octet & 0x0F;
        } else if (octet <= 0xF4) {
            bytesNeeded = 3;
            codePoint = octet & 0x07;
        }
        if (octets.length - i - bytesNeeded > 0) {
            var k = 0;
            while (k < bytesNeeded) {
                octet = octets[i + k + 1];
                codePoint = (codePoint << 6) | (octet & 0x3F);
                k += 1;
            }
        } else {
            codePoint = 0xFFFD;
            bytesNeeded = octets.length - i;
        }
        if (codePoint === 0) {
            break;
        }
        string += String.fromCodePoint(codePoint);
        i += bytesNeeded + 1;
    }
    return string
}

module.exports = function (wasmProvider) {
    async function loadWasm(options) {
        if (!wasm) {
            wasm = await wasmProvider(options);
            wasm.dispatch = (encodedAction, encodedKey, encodedArgs) => {
                const action = decodePtrString(wasm, encodedAction);
                const key = decodePtrString(wasm, encodedKey);
                const args = decodePtrString(wasm, encodedArgs);
                return invocations[key][action](args === 'undefined' ? undefined : JSON.parse(args));
            }
            wasm.setPromiseCallbacks = (encodedKey, encodedPromiseId, resolveFunc, rejectFunc) => {
                const key = decodePtrString(wasm, encodedKey);
                const promiseId = decodePtrString(wasm, encodedPromiseId);
                return invocations[key]['setPromiseCallbacks']({ promiseId, resolveFunc, rejectFunc });
            }
        }
        return wasm;
    }
    async function defineFunction(script, options) {
        await loadWasm(options);
        return (...args) => { // start a isolated context for each invocation
            const ctx = new Context(options);
            const f = ctx.def(script, options);
            const result = f(...args);
            (async () => {
                try {
                    await result;
                } catch(e) {
                    // ignore
                } finally {
                    ctx.dispose();
                }
            })();
            return result;
        };
    };
    defineFunction.context = (options) => { // share context between invocations
        let ctx = undefined;
        return {
            async def(script, options) {
                if (!ctx) {
                    await loadWasm(options);
                    ctx = new Context(options);
                }
                return ctx.def(script, options);
            },
            dispose() {
                if (ctx) {
                    ctx.dispose();
                }
            }
        }
    };
    defineFunction.default = defineFunction; // support import default
    return defineFunction;
}