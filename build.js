#!/usr/bin/env node

const evalWasm = require('fs').readFileSync('./eval.wasm').toString('base64');
require('fs').writeFileSync('index.browser.js', `
module.exports = async function (script, options) {
    const wasm = await require('./load-eval-wasm')({
        async instantiateWasm(info, receiveInstance) {
            const evalWasm = atob('${evalWasm}');
            var bytes = new Uint8Array(evalWasm.length);
            for (var i = 0; i < evalWasm.length; i++) {
                bytes[i] = evalWasm.charCodeAt(i);
            }
            const { instance, module } = await WebAssembly.instantiate(bytes, info);
            receiveInstance(instance, module);
        }
    });
    return require('./define-function')(wasm, script, options);
};
`)