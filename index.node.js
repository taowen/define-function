module.exports = async function (script, options) {
    const wasm = await require('./load-eval-wasm')({
        async instantiateWasm(info, receiveInstance) {
            const buff = require('fs').readFileSync(options?.wasmFile || './eval.wasm');
            const { instance, module } = await WebAssembly.instantiate(buff, info);
            receiveInstance(instance, module);
        }
    });
    return require('./define-function')(wasm, script, options);
};