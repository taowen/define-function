module.exports = async function (script, options) {
    const wasm = await require('./load-eval-wasm')({
        async instantiateWasm(info, receiveInstance) {
            const { instance, module } = await WXWebAssembly.instantiate(
                options?.wasmFile || '/miniprogram_npm/define-function/eval.wasm.br', info);
            receiveInstance(instance, module);
        }
    });
    return require('./define-function')(wasm, script, options);
};