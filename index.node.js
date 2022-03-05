function loadWasm(options) {
    return require('./load-eval-wasm')({
        async instantiateWasm(info, receiveInstance) {
            const buff = require('fs').readFileSync(options?.wasmFile || require('path').join(__dirname, 'eval.wasm'));
            const { instance, module } = await WebAssembly.instantiate(buff, info);
            receiveInstance(instance, module);
        }
    });
}

module.exports = require('./define-function')(loadWasm);