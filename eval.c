#include <emscripten.h>
#include <string.h>
#include <malloc.h>
#include "./quickjs/quickjs.h"
#include "./quickjs/cutils.h"

EM_JS(const char*, _invokeHostFunction, (JSContext *ctx, const char* token, const char* args), {
    return Module.invokeHostFunction(ctx, token, args);
});

EM_JS(void, _dynamicImport, (JSContext *ctx, int argc, JSValueConst *argv, JSValueConst *resolveFunc, JSValueConst *rejectFunc, const char* basename, const char* filename), {
    return Module.dynamicImport(ctx, argc, argv, resolveFunc, rejectFunc, basename, filename);
});

EM_JS(const char*, _getModuleContent, (JSContext *ctx, const char* filename), {
    return Module.getModuleContent(ctx, filename);
});

char *mergeStr(const char *a, const char *b) {
  int aLen = strlen(a);
  int bLen = strlen(b);
  char *ret = malloc(aLen + bLen + 1);
  for (int i = 0; i < aLen; i++) {
      ret[i] = a[i];
  }
  for (int i = 0; i < bLen; i++) {
      ret[aLen + i] = b[i];
  }
  ret[aLen + bLen] = 0;
  return ret;
}

char *dumpException(JSContext* ctx) {
    JSValue realException = JS_GetException(ctx);
    const char* errorMessage = JS_ToCString(ctx, realException);
    JSValue stack = JS_GetProperty(ctx, realException, JS_NewAtom(ctx, "stack"));
    const char* stackStr = JS_ToCString(ctx, stack);
    char* merged = mergeStr(errorMessage, stackStr);
    // malloc memory need to be freed by caller
    return merged;
}

JSValue invokeHostFunction(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic, JSValue *func_data) {
    const char* hostFunctionToken = JS_ToCString(ctx, argv[0]);
    JS_FreeCString(ctx, hostFunctionToken);
    const char* hostFunctionArgs = JS_ToCString(ctx, argv[1]);
    JS_FreeCString(ctx, hostFunctionArgs);
    const char* result = _invokeHostFunction(ctx, hostFunctionToken, hostFunctionArgs);
    if (result == NULL) {
        return JS_UNDEFINED;
    }
    JSValue value = JS_ParseJSON(ctx, result, strlen(result), "");
    // JS_ParseJSON made a copy, we can safely free memory now
    free((void*)result);
    JSValue errorMessage = JS_GetPropertyStr(ctx, value, "__e__");
    if (!JS_IsUndefined(errorMessage)) {
        JS_FreeValue(ctx, value);
        return JS_Throw(ctx, errorMessage);
    }
    return value;
}

/* main loop which calls the user JS callbacks */
void js_std_loop(JSContext *ctx)
{
    JSContext *ctx1;
    int err;
    /* execute the pending jobs */
    for(;;) {
        err = JS_ExecutePendingJob(JS_GetRuntime(ctx), &ctx1);
        if (err <= 0) {
            break;
        }
    }
}

JSModuleDef *js_module_loader(JSContext *ctx,
                              const char *module_name, void *opaque)
{
    JSModuleDef *m;
    JSValue func_val;
    const char* buf = _getModuleContent(ctx, module_name);
    func_val = JS_Eval(ctx, (char *)buf, strlen(buf), module_name,
                        JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(func_val))
        return NULL;
    /* the module is already referenced, so we must free it */
    m = JS_VALUE_GET_PTR(func_val);
    JS_FreeValue(ctx, func_val);
    return m;
}

EMSCRIPTEN_KEEPALIVE
JSContext* newContext() {
    JSRuntime* runtime = JS_NewRuntime();
    JS_SetModuleLoaderFunc(runtime, NULL, js_module_loader, NULL);
    JSContext* ctx = JS_NewContext(runtime);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "__invokeHostFunction", 
        JS_NewCFunctionData(ctx, &invokeHostFunction, /* min argc */0, /* unused magic */0, /* func_data len */0, 0));
    JS_SetPropertyStr(ctx, global, "global", JS_GetGlobalObject(ctx));
    JS_FreeValue(ctx, global);
    return ctx;
}

EMSCRIPTEN_KEEPALIVE
void freeContext(JSContext* ctx) {
    JSRuntime* runtime = JS_GetRuntime(ctx);
    JS_FreeContext(ctx);
    JS_FreeRuntime(runtime);
}

// override quickjs.c definition to make it async
JSValue js_dynamic_import_job(JSContext *ctx, int argc, JSValueConst *argv);
JSValue async_js_dynamic_import_job(JSContext *ctx, int argc, JSValueConst *argv) {
    JSValueConst *newArgv = malloc(sizeof(JSValueConst) * 4); // will free it after callback
    newArgv[0] = argv[0];
    newArgv[1] = argv[1];
    newArgv[2] = argv[2];
    newArgv[3] = argv[3];
    JSValueConst* resolveFunc = &newArgv[0];
    JSValueConst* rejectFunc = &newArgv[1];
    // need to prevent resolveFunc/rejectFunc from GC
    // will free them after callback
    JS_DupValue(ctx, *resolveFunc);
    JS_DupValue(ctx, *rejectFunc);
    const char* basename = JS_ToCString(ctx, newArgv[2]);
    const char* filename = JS_ToCString(ctx, newArgv[3]);
    JS_FreeCString(ctx, basename);
    JS_FreeCString(ctx, filename);
    _dynamicImport(ctx, argc, newArgv, resolveFunc, rejectFunc, basename, filename);
    return JS_UNDEFINED;
}

EMSCRIPTEN_KEEPALIVE
void doDynamicImport(JSContext *ctx, int argc, JSValueConst *argv) {
    JS_FreeValue(ctx, js_dynamic_import_job(ctx, argc, argv));
    js_std_loop(ctx);
}

char *js_default_module_normalize_name(JSContext *ctx, const char *base_name, const char *name);
void js_free(JSContext *ctx, void *ptr);

EMSCRIPTEN_KEEPALIVE
char *pathJoin(JSContext *ctx, const char *base_name, const char *name) {
    char * moduleName = js_default_module_normalize_name(ctx, base_name, name);
    char *copiedModuleName = strdup(moduleName);
    js_free(ctx, moduleName);
    free((void*)base_name);
    free((void*)name);
    return copiedModuleName;
}

EMSCRIPTEN_KEEPALIVE
const char* eval(JSContext* ctx, char* str) {
    JSValue result = JS_Eval(ctx, str, strlen(str), "<eval>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
		return dumpException(ctx);
	}
    JS_FreeValue(ctx, result);
    js_std_loop(ctx);
    free((void*)str);
    return 0;
}

#define __exception __attribute__((warn_unused_result))

__exception int JS_CopyDataProperties(JSContext *ctx,
                                             JSValueConst target,
                                             JSValueConst source,
                                             JSValueConst excluded,
                                             BOOL setprop);

EMSCRIPTEN_KEEPALIVE
const char* load(JSContext* ctx, char* str, const char* filename, const char* meta) {
    JSValue result = JS_Eval(ctx, str, strlen(str), filename, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(result)) {
        free((void*)str);
        free((void*)filename);
        free((void*)meta);
		return dumpException(ctx);
	}
    free((void*)str);
    free((void*)filename);
    JSModuleDef *m = JS_VALUE_GET_PTR(result);
    JSValue metaObj = JS_GetImportMeta(ctx, m);
    JSValue metaObj2 = JS_ParseJSON(ctx, meta, strlen(meta), "");
    free((void*)meta);
    if (JS_CopyDataProperties(ctx, metaObj, metaObj2, JS_UNDEFINED, TRUE)) {
        JS_FreeValue(ctx, metaObj);
        JS_FreeValue(ctx, metaObj2);
        return strdup("failed to copy meta");
    }
    result = JS_EvalFunction(ctx, result);
    JS_FreeValue(ctx, metaObj);
    JS_FreeValue(ctx, metaObj2);
    if (JS_IsException(result)) {
		return dumpException(ctx);
	}
    JS_FreeValue(ctx, result);
    js_std_loop(ctx);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* call(JSContext* ctx, JSValue* pFunc, const char* args) {
    JSValue argsVal = JS_UNDEFINED;
    if (args) {
        argsVal = JS_ParseJSON(ctx, args, strlen(args), "");
        // JS_ParseJSON made a copy, we can safely free memory now
        free((void*)args);
    }
    JSValue result = JS_Call(ctx, *pFunc, JS_UNDEFINED, 1, &argsVal);
    JS_FreeValue(ctx, result);
    js_std_loop(ctx);
    return 0;
}


EMSCRIPTEN_KEEPALIVE
void freeJsValue(JSContext* ctx, JSValue* pVal) {
    if (pVal) {
        JS_FreeValue(ctx, *pVal);
    }
}