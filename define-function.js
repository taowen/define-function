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
            const pScript = encodeString(`
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
                throw new Error(wasm.UTF8ToString(pError));
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
                    const pError = wasm._call(this.ctx, callback.resolveFunc, encodeString(JSON.stringify(v)));
                    if (pError) {
                        this.setFailure(wasm.UTF8ToString(pError));
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
                    const pError = wasm._call(this.ctx, callback.rejectFunc, encodeString('' + e));
                    if (pError) {
                        this.setFailure(wasm.UTF8ToString(pError));
                    } else {
                        wasm._freeJsValue(this.ctx, callback.resolveFunc);
                        callback.resolveFunc = 0;
                        wasm._freeJsValue(this.ctx, callback.rejectFunc);
                        callback.rejectFunc = 0;
                    }
                });
            return encodeString(promiseId);
        }
        // eval.c dispatch will free this memory
        return encodeString(JSON.stringify(invokeResult));
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

function encodeString(string) {
    if (string === undefined) {
        return 0;
    }
    return wasm.allocateUTF8(string);
}

module.exports = function (wasmProvider) {
    async function loadWasm(options) {
        if (!wasm) {
            wasm = await wasmProvider(options);
            wasm.dispatch = (encodedAction, encodedKey, encodedArgs) => {
                const action = wasm.UTF8ToString(encodedAction);
                const key = wasm.UTF8ToString(encodedKey);
                const args = wasm.UTF8ToString(encodedArgs);
                return invocations[key][action](args === 'undefined' ? undefined : JSON.parse(args));
            }
            wasm.setPromiseCallbacks = (encodedKey, encodedPromiseId, resolveFunc, rejectFunc) => {
                const key = wasm.UTF8ToString(encodedKey);
                const promiseId = wasm.UTF8ToString(encodedPromiseId);
                return invocations[key]['setPromiseCallbacks']({ promiseId, resolveFunc, rejectFunc });
            }
            wasm.dynamicImport = (ctx, argc, argv, basename, filename) => {
                console.log(wasm.UTF8ToString(basename), wasm.UTF8ToString(filename));
            }
            wasm.getModuleContent = (ctx, filename) => {
                console.log(wasm.UTF8ToString(filename));
            }
        }
        return wasm;
    }
    async function defineFunction(script, options) {
        await loadWasm(options);
        return (...args) => { // start a isolated context for each invocation
            const ctx = new Context(options);
            const f = ctx.def(script, options);
            let result = undefined;
            try {
                return result = f(...args);
            } finally {
                if (result && result.finally) {
                    result.finally(ctx.dispose.bind(ctx));
                } else {
                    ctx.dispose();
                }
            }
        };
    };
    defineFunction.context = (contextOptions) => { // share context between invocations
        let ctx = undefined;
        return {
            async def(script, options) {
                if (!ctx) {
                    await loadWasm(contextOptions);
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