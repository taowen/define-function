let nextId = 1;

module.exports = function (wasm, script, options) {
    // const loader = await import('./load-eval-wasm.js');
    // const wasm = await loader.default({
    //     async instantiateWasm(info, receiveInstance) {
    //         if (typeof WXWebAssembly !== 'undefined') {
    //                 const { instance, module } = await WXWebAssembly.instantiate(
    //                     options?.wasmFile || '/miniprogram_npm/define-function/eval.wasm.br', info);
    //                 receiveInstance(instance, module);
    //         } else if(typeof window !== 'undefined') {

    //         } else {
    //             const buff = require('fs').readFileSync(options?.wasmFile || './eval.wasm');
    //             const { instance, module } = await WebAssembly.instantiate(buff, info);
    //             receiveInstance(instance, module);
    //         }
    //     }
    // });
    wasm.dispatch = (encodedAction, encodedKey, encodedArgs) => {
        const action = decodePtrString(wasm, encodedAction);
        const key = decodePtrString(wasm, encodedKey);
        const args = decodePtrString(wasm, encodedArgs);
        return wasm[key][action](args === 'undefined' ? undefined : JSON.parse(args));
    }
    wasm.setPromiseCallbacks = (encodedKey, encodedPromiseId, resolveFunc, rejectFunc) => {
        const key = decodePtrString(wasm, encodedKey);
        const promiseId = decodePtrString(wasm, encodedPromiseId);
        return wasm[key]['setPromiseCallbacks']({ promiseId, resolveFunc, rejectFunc });
    }
    return function (...args) {
        const ctx = wasm._newContext();
        const key = `key${nextId++}`;
        const callbacks = {};
        let resolveAsyncResult;
        let rejectAsyncResult;
        function dispose() {
            if (!wasm[key]) {
                return; // already disposed
            }
            for (const { resolveFunc, rejectFunc } of Object.values(callbacks)) {
                if (resolveFunc) {
                    wasm._freeJsValue(ctx, resolveFunc);
                }
                if (rejectFunc) {
                    wasm._freeJsValue(ctx, rejectFunc);
                }
            }
            wasm._free(pScript);
            wasm._freeContext(ctx);
            wasm[key] = undefined;
        }
        const asyncResult = new Promise((resolve, reject) => {
            resolveAsyncResult = resolve;
            rejectAsyncResult = reject;
        }).finally(dispose).catch(() => {});
        let syncResult = () => {
            return Promise.race([asyncResult, (async () => {
                if (options?.timeout) {
                    await new Promise(resolve => setTimeout(resolve, options.timeout));
                    dispose();
                    throw new Error('execute function timeout');
                } else {
                    while(wasm[key]) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            })()]);
        };
        wasm[key] = {
            invoke(invokeArgs) {
                const invokeResult = args[invokeArgs.slot](...invokeArgs.args);
                if (invokeResult && invokeResult.then && invokeResult.catch) {
                    const promiseId = `p${nextId++}`;
                    const callback = callbacks[promiseId] = {
                        promise: invokeResult,
                        rejectFunc: 0, // will be filled by setPromiseCallbacks
                        resolveFunc: 0, // will be filled by setPromiseCallbacks
                    };
                    invokeResult
                        .then(v => {
                            if (!callback.resolveFunc) {
                                return;
                            }
                            const pError = wasm._call(ctx, callback.resolveFunc, encodeString(wasm, JSON.stringify(v)));
                            if (pError) {
                                this.setFailure(decodePtrString(wasm, pError));
                            } else {
                                wasm._freeJsValue(ctx, callback.resolveFunc);
                                callback.resolveFunc = 0;
                                wasm._freeJsValue(ctx, callback.rejectFunc);
                                callback.rejectFunc = 0;
                            }
                        })
                        .catch(e => {
                            if (!callback.rejectFunc) {
                                return;
                            }
                            const pError = wasm._call(ctx, callback.rejectFunc, encodeString(wasm, '' + e));
                            if (pError) {
                                this.setFailure(decodePtrString(wasm, pError));
                            } else {
                                wasm._freeJsValue(ctx, callback.resolveFunc);
                                callback.resolveFunc = 0;
                                wasm._freeJsValue(ctx, callback.rejectFunc);
                                callback.rejectFunc = 0;
                            }
                        });
                    return encodeString(wasm, promiseId);
                }
                // eval.c dispatch will free this memory
                return encodeString(wasm, JSON.stringify(invokeResult));
            },
            setPromiseCallbacks({ promiseId, rejectFunc, resolveFunc }) {
                callbacks[promiseId].resolveFunc = resolveFunc;
                callbacks[promiseId].rejectFunc = rejectFunc;
                return 0;
            },
            setSuccess(value) {
                syncResult = () => value;
                resolveAsyncResult(value);
                return 0;
            },
            setFailure(error) {
                syncResult = () => { throw new Error(error) };
                rejectAsyncResult(new Error(error));
                return 0;
            }
        };
        const pScript = encodeString(wasm, `
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
            `);
        const pError = wasm._eval(ctx, pScript)
        if (pError) {
            throw new Error(decodePtrString(wasm, pError));
        }
        return syncResult();
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