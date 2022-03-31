declare function defineFunction<T extends (...args: any[]) => any>(script: string, options?: {
  timeout?: number,
  disposeManually?: boolean,
}): Promise<T>;
declare interface Context {
  def: typeof defineFunction;
  load(script: string, options?: {
    filename?: string,
    meta?: Record<string, any>
  }): Promise<any>;
  currentStack: string;
  wrapHostFunction(f: Function, options?: { returnsHostObject?: boolean; nowrap?: boolean; }): any;
  inject(target: string, obj: Record<string, any>): void;
  dispose(): void;
}
declare namespace defineFunction {
    var context: (options?: {
      wasmFile?: string,
      loadModuleContent?: (moduleName: string, extra?: { basename: string, filename: string }) => Promise<string>,
      global?: Record<string, any>
    }) => Context;
}
export default defineFunction;