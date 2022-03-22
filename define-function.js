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
    ctx = undefined;
    moduleContents = {};
    disposables = [];
    createPromise;
    invokeCallback;
    deleteCallback;

    constructor(options) {
        this.options = options;
        this.ctx = wasm._newContext();
        contexts.set(this.ctx, this);
        this.def(`
            global.__s__ = global.__s__ || {
                nextId: 1,
                promises: new Map(),
                callbacks: new Map(),
                createPromise() {
                    const promiseId = this.nextId++;
                    const result = { __p__: promiseId };
                    this.promises.set(promiseId, new Promise((resolve, reject) => {
                        result.resolve = this.wrapCallback(resolve);
                        result.reject = this.wrapCallback(reject);
                    }));
                    return result;
                },
                wrapCallback(callback) {
                    const callbackId = this.nextId++;
                    this.callbacks.set(callbackId, callback);
                    return callbackId;
                },
                getAndDeletePromise(promiseId) {
                    const promise = this.promises.get(promiseId);
                    this.promises.delete(promiseId);
                    return promise;
                },
                invokeCallback(callbackId, args) {
                    const callback = this.callbacks.get(callbackId);
                    if (!callback) {
                        return undefined;
                    }
                    return callback.apply(undefined, args);
                },
                deleteCallback(callbackId) {
                    this.callbacks.delete(callbackId);
                }
            };        
        `)();
        this.createPromise = this.def(`return __s__.createPromise()`);
        this.invokeCallback = this.def(`return __s__.invokeCallback(...arguments)`);
        this.deleteCallback = this.def(`return __s__.deleteCallback(...arguments)`);
    }

    dispose() {
        if (!this.ctx) {
            return; // already disposed
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const pModuleContent of Object.values(this.moduleContents)) {
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

    asCallback(callbackId) {
        return (...args) => {
            if (!this.ctx) {
                return;
            }
            try {
                return this.invokeCallback(callbackId, args);
            } finally {
                this.deleteCallback(callbackId);
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
                args.push((...args) => {
                    return v.apply(obj, args.map(arg => arg && arg.__f__ ? this.asCallback(arg.__f__) : arg));
                })
            } else {
                args.push(k);
                args.push(v);
            }
        }
        const f = await this.def(`
        const obj = global[arguments[0]] = global[arguments[0]] || {};
        for (let i = 1; i < arguments.length; i+=2) {
            obj[arguments[i]] = arguments[i+1];
        }`, { disposeManually: true });
        this.disposables.push(f(...args));
    }

    async dynamicImport({ctx, argc, argv, resolveFunc, rejectFunc, basename, filename }) {
        try {
            if (this.options?.loadModuleContent) {
                await this.require(basename, filename)
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
        if (!this.options?.loadModuleContent) {
            throw new Error(`missing options.loadModuleContent can not load content of ${filename} imported by ${basename}`);
        }
        let moduleName = filename;
        if (filename[0] === '.') {
            const pBasename = allocateUTF8(basename);
            const pFilename = allocateUTF8(filename);
            const pModuleName = wasm._pathJoin(this.ctx, pBasename, pFilename);
            moduleName = wasm.UTF8ToString(pModuleName);
            wasm._free(pModuleName);
        }
        if (this.moduleContents[moduleName] !== undefined) {
            return;
        }
        this.moduleContents[moduleName] = 0;
        const content = await this.options.loadModuleContent(moduleName, { basename, filename });
        this.moduleContents[moduleName] = allocateUTF8(content);
        const promises = [];
        for (const importFrom of extractImportFroms(content)) {
            promises.push(this.require(moduleName, importFrom));
        }
        await Promise.all(promises);
    }

    async load(content, options) {
        const filename = options?.filename || `<load${nextId++}>`;
        const promises = [];
        for (const importFrom of extractImportFroms(content)) {
            promises.push(this.require(filename, importFrom));
        }
        await Promise.all(promises);
        const pScript = allocateUTF8(content);
        const pScriptName = allocateUTF8(filename)
        const meta = options?.meta || { url: filename };
        const pMeta = allocateUTF8(JSON.stringify(meta));
        const pError = wasm._load(this.ctx, pScript, pScriptName, pMeta);
        if (pError) {
            throw new Error(wasm.UTF8ToString(pError));
        }
        if (!this._loadModule) {
            this._loadModule = await this.def(`
            return (async() => {
                const [moduleName] = arguments;
                const m = await import(moduleName);
                const exports = {};
                for(const [k, v] of Object.entries(m)) {
                    if (typeof v === 'function') {
                        exports[k] = {__f__:true};
                    } else {
                        exports[k] = v;
                    }
                }
                return JSON.stringify(exports);
            })();
            `)
        }
        const loadedModule = JSON.parse(await this._loadModule(filename));
        for (const [k, v] of Object.entries(loadedModule)) {
            if (v && v.__f__) {
                loadedModule[k] = this.invokeModuleExport.bind(this, filename, k);
            }
        }
        return loadedModule;
    }

    async invokeModuleExport(moduleName, exportName, ...args) {
        if (!this._invokeModuleExport) {
            this._invokeModuleExport = await this.def(`
            return (async() => {
                const [moduleName, exportName, ...args] = arguments;
                const m = await import(moduleName);
                return m[exportName](...args);
            })();
            `)
        }
        return await this._invokeModuleExport(moduleName, exportName, ...args);
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
            const encodedArgs = args.map(arg => typeof arg === 'function' ? { __f__: true} : arg);
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
                            const invokeResult = dispatch('invoke', {
                                slot:i, 
                                args: args.map(arg => typeof arg === 'function' ? { __f__: global.__s__.wrapCallback(arg) } : arg)
                            });
                            if (invokeResult && invokeResult.__p__) {
                                return global.__s__.getAndDeletePromise(invokeResult.__p__);
                            }
                            return invokeResult;
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
            const invocation = invocations[key] = new Invocation({ args, context: this, key}, options?.timeout);
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
                    if (!options?.disposeManually) {
                        invocation.dispose();
                    }
                }
            })();
            if (options?.disposeManually) {
                return invocation;
            }
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
    context;
    key;

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

    dispose() {
        delete invocations[this.key];
    }

    invoke(invokeArgs) {
        const invokeResult = this.args[invokeArgs.slot](...invokeArgs.args);
        if (invokeResult && invokeResult.then && invokeResult.catch) {
            const { __p__, resolve, reject } = this.context.createPromise();
            invokeResult
                .then(v => {
                    if (this.context.ctx) {
                        this.context.invokeCallback(resolve, v);
                    }
                })
                .catch(e => {
                    if (this.context.ctx) {
                        this.context.invokeCallback(reject, '' + e);
                    }
                })
                .finally(() => {
                    if (this.context.ctx) {
                        this.context.deleteCallback(resolve);
                        this.context.deleteCallback(reject);
                    }
                });
            return allocateUTF8(JSON.stringify({ __p__ }));
        }
        // eval.c dispatch will free this memory
        return allocateUTF8(JSON.stringify(invokeResult));
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
            wasm.dynamicImport = (ctx, argc, argv, resolveFunc, rejectFunc, basename, filename) => {
                basename = wasm.UTF8ToString(basename);
                filename = wasm.UTF8ToString(filename);
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
                return context.moduleContents[filename];
            }
        }
        return wasm;
    }
    async function defineFunction(script, options) {
        await loadWasm(options);
        return (...args) => { // start a isolated context for each invocation
            const ctx = new Context(options);
            function defAndCall() {
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
            }
            if (options?.global) {
                return ctx.initGlobal(options?.global).then(defAndCall);
            } else {
                return defAndCall();
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