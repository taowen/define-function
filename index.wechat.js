function loadWasm(options) {
    return require('./load-eval-wasm')({
        async instantiateWasm(info, receiveInstance) {
            const { instance, module } = await WXWebAssembly.instantiate(
                options?.wasmFile || '/miniprogram_npm/define-function/eval.wasm.br', info);
            receiveInstance(instance, module);
        }
    });
}

module.exports = require('./define-function')(loadWasm);