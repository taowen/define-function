let wasm = undefined;
let nextId = 1;
const contexts = new Map();
const invocations = {};

// import {a, b} from 'xxx'
// import ab from 'xxx'
// import * as ab from 'xxx'
const re1 = /import\s+[\w\s,\*\}\{]*?\s+from\s+['"]([^'"]+)['"]/g;
// import 'xxx'
const re2 = /import\s+['"]([^'"]+)['"]/g;
// export * from 'xxx'
const re3 = /export\s+[\w\s,\*\}\{]*?\s+from\s+['"]([^'"]+)['"]/g;
const res = [re1, re2, re3];

function* extractImportFroms(script) {
    if (!script) {
        return
    }
    for (const re of res) {
        for (const match of script.matchAll(re)) {
            yield match[1];
        }
    }
}

class Context {
    options = undefined;
    callbacks = {};
    ctx = undefined;
    dynamicImported = {};

    constructor(options) {
        this.options = options;
        this.ctx = wasm._newContext();
        contexts.set(this.ctx, this);
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
        for (const pModuleContent of Object.values(this.dynamicImported)) {
            wasm._free(pModuleContent);
        }
        wasm._freeContext(this.ctx);
        contexts.delete(this.ctx);
        this.ctx = undefined;
    }

    async initGlobal(global) {
        if (!global) {
            return;
        }
        await this.inject('global', global);
        for (const [k, v] of Object.entries(global)) {
            if (typeof v === 'object') {
                await this.inject(k, v);
            }
        }
    }

    async inject(target, obj) {
        if (!global) {
            return;
        }
        const args = [target];
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'function') {
                args.push(k);
                args.push(v.bind(obj))
            } else {
                args.push(k);
                args.push(v);
            }
        }
        const f = await this.def(`
        const obj = global[arguments[0]] = global[arguments[0]] || {};
        for (let i = 1; i < arguments.length; i+=2) {
            obj[arguments[i]] = arguments[i+1];
        }`);
        f(...args);
    }

    async dynamicImport({ctx, argc, argv, resolveFunc, rejectFunc, basename, filename}) {
        try {
            if (this.options?.dynamicImport) {
                const decodedFileName = wasm.UTF8ToString(filename);
                await this.require(wasm.UTF8ToString(basename), decodedFileName)
            }
        } catch(e) {
            wasm._call(ctx, rejectFunc, allocateUTF8(JSON.stringify(`failed to dynamicImport: ${e}`)));
            wasm._freeJsValue(ctx, resolveFunc);
            wasm._freeJsValue(ctx, rejectFunc);
            wasm._free(argv);
            return;
        }
        wasm._doDynamicImport(ctx, argc, argv);
        wasm._freeJsValue(ctx, resolveFunc);
        wasm._freeJsValue(ctx, rejectFunc);
        wasm._free(argv);
    }

    async require(basename, filename) {
        if (this.options?.dynamicImport) {
            const content = await this.options.dynamicImport(basename, filename);
            this.dynamicImported[filename] = allocateUTF8(content);
            for (const script of extractImportFroms(content)) {
                await this.require(filename, script);
            }
        }
    }

    async load(content, options) {
        const filename = options?.filename || '<load>';
        for (const script of extractImportFroms(content)) {
            await this.require(filename, script);
        }
        const pScript = allocateUTF8(content);
        const pScriptName = allocateUTF8(filename)
        const meta = options?.meta || { url: filename };
        const pMeta = allocateUTF8(JSON.stringify(meta));
        const pError = wasm._load(this.ctx, pScript, pScriptName, pMeta);
        if (pError) {
            throw new Error(wasm.UTF8ToString(pError));
        }
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
            let hasCallback = false;
            const encodedArgs = [];
            for (const arg of args) {
                if (typeof arg === 'function') {
                    hasCallback = true;
                    encodedArgs.push({ __f__: true });
                } else {
                    encodedArgs.push(arg);
                }
            }
            const pScript = allocateUTF8(`
            (() => {
                const __key = '${key}';
                const __args = ${JSON.stringify(encodedArgs)};
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
                    if (!hasCallback) {
                        delete invocations[key];
                    }
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
                    const pError = wasm._call(this.ctx, callback.resolveFunc, allocateUTF8(JSON.stringify(v)));
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
                    const pError = wasm._call(this.ctx, callback.rejectFunc, allocateUTF8('' + e));
                    if (pError) {
                        this.setFailure(wasm.UTF8ToString(pError));
                    } else {
                        wasm._freeJsValue(this.ctx, callback.resolveFunc);
                        callback.resolveFunc = 0;
                        wasm._freeJsValue(this.ctx, callback.rejectFunc);
                        callback.rejectFunc = 0;
                    }
                });
            return allocateUTF8(promiseId);
        }
        // eval.c dispatch will free this memory
        return allocateUTF8(JSON.stringify(invokeResult));
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

function allocateUTF8(string) {
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
                const args = wasm.UTF8ToString(encodedArgs);
                const key = wasm.UTF8ToString(encodedKey);
                return invocations[key][action](args === 'undefined' ? undefined : JSON.parse(args));
            }
            wasm.setPromiseCallbacks = (encodedKey, encodedPromiseId, resolveFunc, rejectFunc) => {
                const key = wasm.UTF8ToString(encodedKey);
                const promiseId = wasm.UTF8ToString(encodedPromiseId);
                return invocations[key]['setPromiseCallbacks']({ promiseId, resolveFunc, rejectFunc });
            }
            wasm.dynamicImport = (ctx, argc, argv, resolveFunc, rejectFunc, basename, filename) => {
                const context = contexts.get(ctx);
                if (!context) {
                    wasm._call(ctx, rejectFunc, allocateUTF8(JSON.stringify('internal error: context not found')));
                    wasm._freeJsValue(ctx, resolveFunc);
                    wasm._freeJsValue(ctx, rejectFunc);
                    wasm._free(argv);
                    return;
                }
                context.dynamicImport({ ctx, argc, argv, resolveFunc, rejectFunc, basename, filename });
            }
            wasm.getModuleContent = (ctx, filename) => {
                filename = wasm.UTF8ToString(filename);
                const context = contexts.get(ctx);
                if (!context) {
                    throw new Error(`failed to getModuleContent of ${filename}`)
                }
                const content = context.dynamicImported[filename];
                if (!content) {
                    throw new Error(`failed to getModuleContent of ${filename}`)
                }
                return content;
            }
        }
        return wasm;
    }
    async function defineFunction(script, options) {
        await loadWasm(options);
        const ctx = new Context(options);
        await ctx.initGlobal(options?.global);
        return (...args) => { // start a isolated context for each invocation
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
                    ctx = new Context(contextOptions);
                    await ctx.initGlobal(contextOptions?.global);
                }
                return ctx.def(script, options);
            },
            async load(script, options) {
                if (!ctx) {
                    await loadWasm(contextOptions);
                    ctx = new Context(contextOptions);
                    await ctx.initGlobal(contextOptions?.global);
                }
                return await ctx.load(script, options)
            },
            async require(basename, filename) {
                if (!ctx) {
                    await loadWasm(contextOptions);
                    ctx = new Context(contextOptions);
                    await ctx.initGlobal(contextOptions?.global);
                }
                await ctx.require(basename, filename)
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