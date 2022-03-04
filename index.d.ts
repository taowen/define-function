declare module 'define-function' {
    function defineFunction<T extends (...args: any[]) => any>(script: string, options?: {
      wasmFile?: string,
      timeout?: number
    }): T;
    export default defineFunction;
}