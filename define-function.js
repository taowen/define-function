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
    createPromise;
    invokeSandboxFunction;
    deleteSandboxFunction;
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
                hostInspect: undefined, // inject later
                createPromise() {
                    const promiseId = this.nextId++;
                    const result = { __p__: promiseId };
                    this.promises.set(promiseId, new Promise((resolve, reject) => {
                        result.resolve = this.wrapSandboxFunction(resolve);
                        result.reject = this.wrapSandboxFunction(reject);
                    }));
                    return result;
                },
                wrapSandboxFunction(callback, extra) {
                    let callbackId = this.callbacksLookup.get(callback);
                    if (callbackId === undefined) {
                        callbackId = this.nextId++;
                        this.callbacks.set(callbackId, callback);
                        this.callbacksLookup.set(callback, callbackId);
                    }
                    return { __c__: callbackId, ...extra };
                },
                getAndDeletePromise(promiseId) {
                    const promise = this.promises.get(promiseId);
                    this.promises.delete(promiseId);
                    return promise;
                },
                invokeSandboxFunction(callbackToken, args) {
                    const callbackId = callbackToken.__c__;
                    if (!callbackId) {
                        throw new Error('invokeSandboxFunction with invalid token: ' + JSON.stringify(callbackToken));
                    }
                    const callback = this.callbacks.get(callbackId);
                    if (!callback) {
                        return undefined;
                    }
                    return callback.apply(undefined, args);
                },
                deleteSandboxFunction(callbackToken) {
                    const callbackId = callbackToken.__c__;
                    if (!callbackId) {
                        throw new Error('deleteSandboxFunction with invalid token: ' + JSON.stringify(callbackToken));
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
                    this.hostInspect(msg, typeof obj === 'object' ? { __o__: objId, keys: Reflect.ownKeys(obj) } : obj);
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
                asHostFunction(hostFunctionToken) {
                    if(!hostFunctionToken?.__h__) {
                        throw new Error('invalid host function token: '+ JSON.stringify(hostFunctionToken));
                    }
                    return (...args) => {
                        return this.invokeHostFunction(hostFunctionToken, args);
                    };
                },
                invokeHostFunction(hostFunctionToken, args) {
                    if (!hostFunctionToken.nowrap) {
                        args = args.map(arg => typeof arg === 'function' ? this.wrapSandboxFunction(arg, { once: true }) : arg);
                        if (args[0] && typeof args[0] === 'object') {
                            for (const [k, v] of Object.entries(args[0])) {
                                if (typeof v === 'function') {
                                    args[0][k] = this.wrapSandboxFunction(v, { once: true });
                                }
                            }
                        }
                    }
                    const invokeResult = __invokeHostFunction(JSON.stringify(hostFunctionToken), JSON.stringify(args));
                    if (invokeResult?.__p__) {
                        return this.getAndDeletePromise(invokeResult.__p__);
                    }
                    return invokeResult;
                },
                callMethod(hostObj, method, ...args) {
                    return this.asHostFunction(hostObj)('callMethod', method, ...args);
                },
                getProp(hostObj, prop) {
                    return this.asHostFunction(hostObj)('getProp', prop);
                },
                setProp(hostObj, prop, propVal) {
                    return this.asHostFunction(hostObj)('setProp', prop, propVal);
                },
                deleteHostObject(hostObj) {
                    return this.asHostFunction(hostObj)('delete');
                }
            };        
        `);
        this.createPromise = this.def(`return __s__.createPromise()`);
        this.invokeSandboxFunction = this.def(`return __s__.invokeSandboxFunction(...arguments)`);
        this.deleteSandboxFunction = this.def(`return __s__.deleteSandboxFunction(...arguments)`);
        this.getInspectingObjectProp = this.def(`return __s__.getInspectingObjectProp(...arguments)`);
        this.currentStack = this.def(`return __s__.currentStack`);
        if (options?.global) {
            this.inject('global', options.global);
            for (const [k, v] of Object.entries(options.global)) {
                if (typeof v === 'object') {
                    this.inject(k, v);
                }
            }
        }
        this.def(`__s__.hostInspect = arguments[0]`)(this.wrapHostFunction(this.hostInspect.bind(this), { nowrap: true }));
    }

    dispose() {
        if (!this.ctx) {
            return; // already disposed
        }
        for (const pModuleContent of Object.values(this.moduleContents)) {
            wasm._free(pModuleContent);
        }
        wasm._freeContext(this.ctx);
        contexts.delete(this.ctx);
        this.ctx = undefined;
    }

    hostInspect(msg, obj) {
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

    asSandboxFunction(callbackToken) {
        let calledOnce = false;
        return (...args) => {
            if (!this.ctx) {
                return;
            }
            if (callbackToken.once) {
                if (calledOnce) {
                    throw new Error(`callback ${JSON.stringify(callbackToken)} can only be callback once, if need to callback multiple times, use __s__.wrapSandboxFunction to manage callback lifetime explicitly`)
                }
                calledOnce = true;
            }
            if (callbackToken.expectsHostObject) {
                args = args.map(arg => arg && typeof arg === 'object' ? this.wrapHostObject(arg) : arg);
            }
            try {
                return this.invokeSandboxFunction(callbackToken, args);
            } finally {
                if (callbackToken.once) {
                    this.deleteSandboxFunction(callbackToken);
                }
            }
        }
    }

    inject(target, obj) {
        const args = [target];
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'function') {
                args.push(k);
                args.push(this.wrapHostFunction(v))
            } else {
                args.push(k);
                args.push(v);
            }
        }
        const f = this.def(`
        const obj = global[arguments[0]] = global[arguments[0]] || {};
        for (let i = 1; i < arguments.length; i+=2) {
            obj[arguments[i]] = arguments[i+1];
        }`);
        f(...args);
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
                        exports[k] = __s__.wrapSandboxFunction(v);
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
                loadedModule[k] = this.asSandboxFunction(v);
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
            const setSuccessToken = invocation.wrapHostFunction(invocation.setSuccess.bind(invocation), { nowrap: true });
            const setFailureToken = invocation.wrapHostFunction(invocation.setFailure.bind(invocation), { nowrap: true });
            const encodedArgs = args.map((arg, index) => typeof arg === 'function' ? invocation.wrapHostFunction(arg, { argIndex: index}) : arg);
            this.loadSync(`
            (() => {
                const setSuccess = __s__.asHostFunction(${JSON.stringify(setSuccessToken)});
                const setFailure = __s__.asHostFunction(${JSON.stringify(setFailureToken)});
                const args = ${JSON.stringify(encodedArgs)};
                function f() {
                    ${script}
                }
                try {
                    const result = f.apply(undefined, args.map(arg => arg?.__h__ ? __s__.asHostFunction(arg) : arg));
                    if (result && result.then && result.catch) {
                        result
                            .then(v => { setSuccess(v); })
                            .catch(e => { setFailure('' + e + '' + e.stack); })
                    } else {
                        setSuccess(result);
                    }
                } catch(e) {
                    setFailure('' + e + '' + e.stack);
                }
            })();
            `, options);
            (async () => {
                try {
                    await invocation.asyncResult;
                } catch (e) {
                    // ignore
                } finally {
                    invocation.dispose();
                }
            })();
            return invocation.syncResult();
        }
    }

    wrapHostFunction(f, extra) {
        const hfId = nextId++;
        this.hostFunctions.set(hfId, f);
        return { __h__: hfId, ...extra }
    }

    deleteHostFunction(hostFunctionToken) {
        const hfId = hostFunctionToken.__h__;
        if (!hfId) {
            throw new Error('deleteHostFunction with invalid token: ' + JSON.stringify(hostFunctionToken));
        }
        this.hostFunctions.delete(hfId);
    }
    unwrapHostFunctionArg(arg) {
        if (arg.__c__) {
            return this.asSandboxFunction(arg);
        }
        if (arg.__h__) {
            if (arg.isObject) {
                return this.hostFunctions.get(arg.__h__)('this');
            }
            return this.hostFunctions.get(arg.__h__);
        }
        throw new Error('unexpected');
    }
    invokeHostFunction(hostFunctionToken, args) {
        const hfId = hostFunctionToken.__h__;
        if (!hfId) {
            throw new Error('callHostFunction with invalid token: ' + JSON.stringify(hostFunctionToken));
        }
        if (!hostFunctionToken.nowrap) {
            args = args.map(arg => arg?.__c__ || arg?.__h__ ? this.unwrapHostFunctionArg(arg) : arg);
            if (args[0] && typeof args[0] === 'object') {
                for (const [k, v] of Object.entries(args[0])) {
                    if (v?.__c__ || v?.__h__) {
                        args[0][k] = this.unwrapHostFunctionArg(v);
                    }
                }
            }
        }
        const hostFunc = this.hostFunctions.get(hfId);
        if (hostFunc === undefined) {
            throw new Error('host function not found: ' + JSON.stringify(hostFunctionToken));
        }
        const invokeResult = hostFunc(...args);
        // promise will be passed-through automatically
        if (invokeResult && invokeResult.then && invokeResult.catch) {
            const { __p__, resolve, reject } = this.createPromise();
            invokeResult
                .then(v => {
                    if (this.ctx) {
                        this.invokeSandboxFunction(resolve, [v]);
                    }
                })
                .catch(e => {
                    if (this.ctx) {
                        this.invokeSandboxFunction(reject, ['' + e]);
                    }
                })
                .finally(() => {
                    if (this.ctx) {
                        this.deleteSandboxFunction(resolve);
                        this.deleteSandboxFunction(reject);
                    }
                });
            return { __p__ };
        }
        // non JSON stringifyable circular object need to be declared explicitly with returnsHostObject: true
        if (hostFunctionToken.returnsHostObject) {
            return this.wrapHostObject(invokeResult);
        }
        return invokeResult;
    }

    wrapHostObject(val) {
        if (!val) {
            return val;
        }
        if (typeof val !== 'object') {
            return val;
        }
        const token = this.wrapHostFunction((action, prop, ...args) => {
            switch(action) {
                case 'this': 
                    return val;
                case 'callMethod':
                    return this.wrapHostObject(val[prop](...args));
                case 'getProp':
                    return this.wrapHostObject(val[prop]);
                case 'setProp':
                    val[prop] = args;
                    return undefined;
                case 'delete':
                    this.deleteHostFunction(token);
                    return undefined;
            }
            throw new Error(`unknown action: ${action}`);
        }, { isObject: true })
        return token;
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

    wrapHostFunction(f, extra) {
        const hostFunctionToken = this.context.wrapHostFunction(f, extra);
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
                try {
                    const result = JSON.stringify(context.invokeHostFunction(JSON.parse(token), JSON.parse(args)));
                    // eval.c invokeHostFunction will free this memory
                    return allocateUTF8(result);
                } catch(e) {
                    return allocateUTF8(JSON.stringify({ __e__: e?.stack || `${e}`}));
                }
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
            return defAndCall();
        };
    };
    defineFunction.context = async (contextOptions) => { // share context between invocations
        await loadWasm(contextOptions);
        const ctx = new Context(contextOptions);
        return {
            def(script, options) {
                return ctx.def(script, options);
            },
            load(script, options) {
                return ctx.load(script, options)
            },
            get currentStack() {
                return ctx.currentStack();
            },
            inject(target, obj) {
                ctx.inject(target, obj);
            },
            wrapHostFunction(f, extra) {
                return ctx.wrapHostFunction(f, extra);
            },
            dispose() {
                ctx.dispose();
            }
        }
    };
    defineFunction.default = defineFunction; // support import default
    return defineFunction;
}