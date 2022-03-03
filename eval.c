#include <emscripten.h>
#include <string.h>
#include <malloc.h>
#include "./quickjs/quickjs.h"

EM_JS(const char*, _dispatch, (const char* action, const char* key, const char* args), {
    return Module.dispatch(action, key, args);
});

EM_JS(const char*, _setPromiseCallbacks, (const char* key, const char* promiseId, JSValue* resolve, JSValue* reject), {
    return Module.setPromiseCallbacks(key, promiseId, resolve, reject);
});

EM_JS(void, js_log, (const char* msg), {
    return Module.log(msg);
});

JSValue dispatch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic, JSValue *func_data) {
    const char* action = JS_ToCString(ctx, argv[0]);
    const char* key = JS_ToCString(ctx, argv[1]);
    const char* result = _dispatch(action, key, JS_ToCString(ctx, argv[2]));
    if (result == 0) {
        return JS_UNDEFINED;
    }
    if (result[0] == 'p') { // is promise
        const char* promiseId = result;
        JSValue* callbacks = malloc(sizeof(JSValue) * 2);
        JSValue promise = JS_NewPromiseCapability(ctx, callbacks);
        _setPromiseCallbacks(key, promiseId, &callbacks[0], &callbacks[1]);
        // _setPromiseCallbacks should copy promiseId
        free((void*)promiseId);
        return promise;
    }
    JSValue value = JS_ParseJSON(ctx, result, strlen(result), "");
    // JS_ParseJSON made a copy, we can safely free memory now
    free((void*)result);
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

EMSCRIPTEN_KEEPALIVE
JSContext* newContext() {
    JSRuntime* runtime = JS_NewRuntime();
    JSContext* ctx = JS_NewContext(runtime);
    return ctx;
}

EMSCRIPTEN_KEEPALIVE
void freeContext(JSContext* ctx) {
    JS_FreeRuntime(JS_GetRuntime(ctx));
    JS_FreeContext(ctx);
}

EMSCRIPTEN_KEEPALIVE
const char* eval(JSContext* ctx, char* str) {
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue dispatchFunc = JS_NewCFunctionData(ctx, &dispatch, /* min argc */0, /* unused magic */0, /* func_data len */0, 0);
    JS_SetPropertyStr(ctx, global, "__dispatch", dispatchFunc);
    JSValue result = JS_Eval(ctx, str, strlen(str), "<eval>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
		JSValue realException = JS_GetException(ctx);
		return JS_ToCString(ctx, realException);
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
    if (JS_IsException(result)) {
		JSValue realException = JS_GetException(ctx);
		return JS_ToCString(ctx, realException);
	}
    JS_FreeValue(ctx, result);
    js_std_loop(ctx);
    return 0;
}