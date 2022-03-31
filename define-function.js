let wasm = undefined;
let nextId = 1;
const contexts = new Map();

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
    hostFunctions = new Map();

    constructor(options) {
        this.options = options;
        this.ctx = wasm._newContext();
        contexts.set(this.ctx, this);
        this.loadSync(`
            global.__s__ = global.__s__ || {
                nextId: 1,
                promises: new Map(),
                callbacks: new Map(),
                callbacksLookup: new Map(),
                inspectingObjects: new Map(),
                currentStack: '',
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
                    let callbackId = this.callbacksLookup.get(callback);
                    if (callbackId === undefined) {
                        callbackId = this.nextId++;
                        this.callbacks.set(callbackId, callback);
                        this.callbacksLookup.set(callback, callbackId);
                    }
                    return { __c__: callbackId };
                },
                getAndDeletePromise(promiseId) {
                    const promise = this.promises.get(promiseId);
                    this.promises.delete(promiseId);
                    return promise;
                },
                invokeCallback(callbackToken, args) {
                    const callbackId = callbackToken.__c__;
                    if (!callbackId) {
                        throw new Error('invokeCallback with invalid token: ' + callbackToken);
                    }
                    const callback = this.callbacks.get(callbackId);
                    if (!callback) {
                        return undefined;
                    }
                    return callback.apply(undefined, args);
                },
                deleteCallback(callbackToken) {
                    const callbackId = callbackToken.__c__;
                    if (!callbackId) {
                        throw new Error('deleteCallback with invalid token: ' + callbackToken);
                    }
                    let callback = this.callbacks.get(callbackId);
                    if (callback !== undefined) {
                        this.callbacks.delete(callbackId);
                        this.callbacksLookup.delete(callback);
                    }
                },
                inspect(msg, obj) {
                    const objId = this.nextId++;
                    this.inspectingObjects.set(objId, obj);
                    inspect(msg, typeof obj === 'object' ? { __o__: objId, keys: Reflect.ownKeys(obj) } : obj);
                },
                getInspectingObjectProp(objId, prop) {
                    const val = this.inspectingObjects.get(objId)[prop];
                    if (val && typeof val === 'object') {
                        const valObjId = this.nextId++;
                        this.inspectingObjects.set(valObjId, val);
                        return { __o__: valObjId, keys: Reflect.ownKeys(val) };
                    }
                    return val;
                },
                invokeHostFunction(hostFunctionToken, args) {
                    const invokeResult = __invokeHostFunction(JSON.stringify(hostFunctionToken), JSON.stringify(args));
                    if (invokeResult && invokeResult.__p__) {
                        return this.getAndDeletePromise(invokeResult.__p__);
                    }
                    return invokeResult;
                }
            };        
        `);
        this.createPromise = this.def(`return __s__.createPromise()`);
        this.invokeCallback = this.def(`return __s__.invokeCallback(...arguments)`);
        this.deleteCallback = this.def(`return __s__.deleteCallback(...arguments)`);
        this.getInspectingObjectProp = this.def(`return __s__.getInspectingObjectProp(...arguments)`);
        this.currentStack = this.def(`return __s__.currentStack`);
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

    inspect(msg, obj) {
        obj = this.wrapProxy(obj);
        console.warn('inspecting...', msg, obj);
        debugger;
    }

    wrapProxy(obj) {
        if (!obj) {
            return obj;
        }
        if (!obj.__o__) {
            return obj;
        }
        const proxy = {};
        for (const key of obj.keys) {
            Object.defineProperty(proxy, key, {
                enumerable: true,
                get: () => {
                    return this.wrapProxy(this.getInspectingObjectProp(obj.__o__, key));
                }
            });
        }
        return proxy;
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

    asCallback(callbackToken) {
        return (...args) => {
            if (!this.ctx) {
                return;
            }
            return this.invokeCallback(callbackToken, args);
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
                    args = args.map(arg => arg?.__c__ ? this.asCallback(arg) : arg);
                    if (args[0] && typeof args[0] === 'object') {
                        for (const [k, v] of Object.entries(args[0])) {
                            args[0][k] = v?.__c__ ? this.asCallback(v) : v;
                        }
                    }
                    return v.apply(obj, args);
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

    loadSync(content, options) {
        const filename = options?.filename || `<load${nextId++}>`;
        const pScript = allocateUTF8(content);
        const pScriptName = allocateUTF8(filename)
        const meta = options?.meta || { url: filename };
        const pMeta = allocateUTF8(JSON.stringify(meta));
        const pError = wasm._load(this.ctx, pScript, pScriptName, pMeta);
        if (pError) {
            const error = new Error(wasm.UTF8ToString(pError));
            wasm._free(pError);
            throw error;
        }
    }

    async load(content, options) {
        const filename = options?.filename || `<load${nextId++}>`;
        const promises = [];
        for (const importFrom of extractImportFroms(content)) {
            promises.push(this.require(filename, importFrom));
        }
        await Promise.all(promises);
        this.loadSync(content, { ...options, filename });
        if (!this._loadModule) {
            this._loadModule = await this.def(`
            return (async() => {
                const [moduleName] = arguments;
                const m = await import(moduleName);
                const exports = {};
                for(const [k, v] of Object.entries(m)) {
                    if (typeof v === 'function') {
                        exports[k] = __s__.wrapCallback(v);
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
            if (v?.__c__) {
                loadedModule[k] = this.asCallback(v);
            }
        }
        return loadedModule;
    }

    def(script, options) {
        if (!this.ctx) {
            throw new Error('context has been disposed');
        }
        return (...args) => {
            if (!this.ctx) {
                throw new Error('context has been disposed');
            }
            const invocation = new Invocation(this, options?.timeout);
            const encodedArgs = args.map(arg => typeof arg === 'function' ? invocation.wrapHostFunction(arg) : arg);
            const pScript = allocateUTF8(`
            (() => {
                const setSuccess = ${JSON.stringify(invocation.wrapHostFunction(invocation.setSuccess.bind(invocation)))};
                const setFailure = ${JSON.stringify(invocation.wrapHostFunction(invocation.setFailure.bind(invocation)))};
                const __args = ${JSON.stringify(encodedArgs)};
                function decodeArg(arg, i) {
                    // the argument is a function
                    if (arg && arg.__h__) {
                        const hostFunction = arg;
                        return function(...args) {
                            args = args.map(arg => typeof arg === 'function' ? global.__s__.wrapCallback(arg) : arg);
                            if (args[0] && typeof args[0] === 'object') {
                                for (const [k, v] of Object.entries(args[0])) {
                                    args[0][k] = typeof v === 'function' ? global.__s__.wrapCallback(v) : v;
                                }
                            }
                            return __s__.invokeHostFunction(hostFunction, args);
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
                            .then(v => { __s__.invokeHostFunction(setSuccess, [v]); })
                            .catch(e => { __s__.invokeHostFunction(setFailure, ['' + e + '' + e.stack]); })
                    } else {
                        __s__.invokeHostFunction(setSuccess, [result]);
                    }
                } catch(e) {
                    __s__.invokeHostFunction(setFailure, ["" + e + "" + e.stack]);
                }
            })();
            `);
            const pError = wasm._eval(this.ctx, pScript);
            if (pError) {
                const error = new Error(wasm.UTF8ToString(pError));
                wasm._free(pError);
                throw error;
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

    wrapHostFunction(f) {
        const hfId = nextId++;
        this.hostFunctions.set(hfId, f);
        return { __h__: hfId }
    }

    deleteHostFunction(hostFunctionToken) {
        const hfId = hostFunctionToken.__h__;
        if (!hfId) {
            throw new Error('deleteHostFunction with invalid token: ' + hostFunctionToken);
        }
        this.hostFunctions.delete(hfId);
    }

    invokeHostFunction(hostFunctionToken, args) {
        const hfId = hostFunctionToken.__h__;
        if (!hfId) {
            throw new Error('callHostFunction with invalid token: ' + hostFunctionToken);
        }
        const invokeResult = this.hostFunctions.get(hfId)(...args);
        if (invokeResult && invokeResult.then && invokeResult.catch) {
            const { __p__, resolve, reject } = this.createPromise();
            invokeResult
                .then(v => {
                    if (this.ctx) {
                        this.invokeCallback(resolve, [v]);
                    }
                })
                .catch(e => {
                    if (this.ctx) {
                        this.invokeCallback(reject, ['' + e]);
                    }
                })
                .finally(() => {
                    if (this.ctx) {
                        this.deleteCallback(resolve);
                        this.deleteCallback(reject);
                    }
                });
            return { __p__ };
        }
        return invokeResult;
    }
}

class Invocation {

    context;
    asyncResult;
    syncResult;
    resolveAsyncResult;
    rejectAsyncResult;
    hostFunctionTokens = [];

    constructor(context, timeout) {
        this.context = context;
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
        for (const hostFunctionToken of this.hostFunctionTokens) {
            this.context.deleteHostFunction(hostFunctionToken);
        }
    }

    wrapHostFunction(f) {
        const hostFunctionToken = this.context.wrapHostFunction(f);
        this.hostFunctionTokens.push(hostFunctionToken);
        return hostFunctionToken;
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
                    throw new Error(`getModuleContent of ${filename} missing context`)
                }
                return context.moduleContents[filename];
            }
            wasm.invokeHostFunction = (ctx, token, args) => {
                token = wasm.UTF8ToString(token);
                args = wasm.UTF8ToString(args);
                const context = contexts.get(ctx);
                if (!context) {
                    throw new Error(`invokeHostFunction missing context`);
                }
                const result = JSON.stringify(context.invokeHostFunction(JSON.parse(token), JSON.parse(args)));
                // eval.c invokeHostFunction will free this memory
                return allocateUTF8(result);
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
            get currentStack() {
                return ctx.currentStack();
            },
            wrapHostFunction(f) {
                return ctx.wrapHostFunction(f);
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