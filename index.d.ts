declare function defineFunction<T extends (...args: any[]) => any>(script: string, options?: {
  wasmFile?: string,
  timeout?: number
}): T;
declare interface Context {
  def: typeof defineFunction;
  dispose(): void;
}
declare namespace defineFunction {
    var context: (options?: {
      wasmFile?: string,
    }) => Context;
}
export default defineFunction;