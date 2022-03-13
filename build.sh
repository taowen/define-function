#!/usr/bin/env bash

source ./emsdk/emsdk_env.sh --build=Release
# emsdk install latest
# emsdk activate latest
pushd quickjs
git reset --hard HEAD
git apply ../quickjs.patch
popd
emcc \
    quickjs/quickjs.c \
    quickjs/cutils.c \
    quickjs/libregexp.c \
    quickjs/libbf.c \
    quickjs/libunicode.c \
    eval.c \
    -o eval.js \
    -Os -s WASM=1 \
    -DCONFIG_VERSION="\"1.0.0\"" \
    -DDUMP_LEAKS="true" \
    -s ASSERTIONS=0 -s ENVIRONMENT='shell' \
    -s WASM_ASYNC_COMPILATION=1 \
    -s MODULARIZE=1 -s EXPORT_ES6=0 \
    -s FILESYSTEM=0 -s SINGLE_FILE=0 \
    -s TOTAL_STACK=2MB -s INITIAL_MEMORY=4MB \
    -s ALLOW_MEMORY_GROWTH=1 -s ALLOW_TABLE_GROWTH=1 \
    -s INCOMING_MODULE_JS_API=[] -s DYNAMIC_EXECUTION=0 \
    -s EXPORTED_FUNCTIONS=["_malloc","_free"] \
    --memory-init-file 0 \
    -s AGGRESSIVE_VARIABLE_ELIMINATION=1 --closure 0 --minify 0
brotli -9 -f eval.wasm
rm -rf wechat
mkdir wechat
cp index.wechat.js wechat/index.js
cp define-function.js wechat/define-function.js
cp load-eval-wasm.js wechat/load-eval-wasm.js
cp eval.wasm.br wechat/eval.wasm.br
./build.js