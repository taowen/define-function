#!/usr/bin/env bash

source ./emsdk/emsdk_env.sh --build=Release
# emsdk install latest
# emsdk activate latest
emcc \
    eval.c \
    quickjs/quickjs.c \
    quickjs/cutils.c \
    quickjs/libregexp.c \
    quickjs/libbf.c \
    quickjs/libunicode.c \
    -o eval.js \
    -O3 -s WASM=1 \
    -DCONFIG_VERSION="\"1.0.0\"" \
    -s ASSERTIONS=0 -s ENVIRONMENT='node' \
    -s WASM_ASYNC_COMPILATION=0 \
    -s MODULARIZE=1 -s EXPORT_ES6=0 \
    -s FILESYSTEM=0 -s SINGLE_FILE=0 \
    -s GLOBAL_BASE=1024 -s TOTAL_STACK=2MB -s INITIAL_MEMORY=4MB \
    -s ALLOW_MEMORY_GROWTH=1 -s ALLOW_TABLE_GROWTH=1 \
    -s INCOMING_MODULE_JS_API=[] -s DYNAMIC_EXECUTION=0 \
    -s EXPORTED_FUNCTIONS=["_eval","_malloc","_free"] \
    --memory-init-file 0 \
    -s AGGRESSIVE_VARIABLE_ELIMINATION=1 --closure 0