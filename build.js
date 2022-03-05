#!/usr/bin/env node

const evalWasm = require('fs').readFileSync('./eval.wasm').toString('base64');
require('fs').writeFileSync('index.browser.js', `
function loadWasm(options) {
    return require('./load-eval-wasm')({
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
}
module.exports = require('./define-function')(loadWasm);
`)