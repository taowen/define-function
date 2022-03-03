#include <emscripten.h>
#include <string.h>
#include "./quickjs/quickjs.h"

EM_JS(const char*, callbackJs, (const char* args), {
    return Module.invoke(args);
});

JSValue invoke(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic, JSValue *func_data) {
    const char* result = callbackJs(JS_ToCString(ctx, argv[0]));
    return JS_ParseJSON(ctx, result, strlen(result), "");
}

// TODO: free result
// TODO: pass exception back as exception
EMSCRIPTEN_KEEPALIVE
const char* eval(char* str) {
    JSRuntime* runtime = JS_NewRuntime();
    JSContext* ctx = JS_NewContext(runtime);
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue func_obj = JS_NewCFunctionData(ctx, &invoke, /* min argc */0, /* unused magic */0, /* func_data len */0, 0);
    JS_SetPropertyStr(ctx, global, "invoke", func_obj);
    JSValue result = JS_Eval(ctx, str, strlen(str), "<eval>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        JSValue realException = JS_GetException(ctx);
        return JS_ToCString(ctx, realException);
    }
    JSValue json = JS_JSONStringify(ctx, result, JS_UNDEFINED, JS_UNDEFINED);
    JS_FreeValue(ctx, result);
    return JS_ToCString(ctx, json);
}