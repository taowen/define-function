#include <emscripten.h>
#include <string.h>
#include <malloc.h>
#include "./quickjs/quickjs.h"

EM_JS(const char*, _dispatch, (const char* action, const char* key, const char* args), {
    return Module.dispatch(action, key, args);
});

JSValue dispatch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic, JSValue *func_data) {
    const char* result = _dispatch(JS_ToCString(ctx, argv[0]), JS_ToCString(ctx, argv[1]), JS_ToCString(ctx, argv[2]));
    if (result == 0) {
        return JS_UNDEFINED;
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

// TODO: free JSContext
EMSCRIPTEN_KEEPALIVE
const char* eval(char* str) {
    JSRuntime* runtime = JS_NewRuntime();
    JSContext* ctx = JS_NewContext(runtime);
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue dispatchFunc = JS_NewCFunctionData(ctx, &dispatch, /* min argc */0, /* unused magic */0, /* func_data len */0, 0);
    JS_SetPropertyStr(ctx, global, "__dispatch", dispatchFunc);
    JSValue result = JS_Eval(ctx, str, strlen(str), "<eval>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
		JSValue realException = JS_GetException(ctx);
		return JS_ToCString(ctx, realException);
	}
    js_std_loop(ctx);
    return 0;
}