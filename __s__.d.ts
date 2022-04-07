type sandboxFunctionToken = { __brand: 'sandboxFunctionToken' }
declare const __s__: {
    wrapSandboxFunction(f: Function, extra?: { once?: boolean, expectsHostObject?: boolean }): sandboxFunctionToken;
    deleteSandboxFunction(token: sandboxFunctionToken);
    getProp(hostObj: any, prop: string | number | symbol): any;
    setProp(hostObj: any, prop: string | number | symbol, value: any): void;
    callMethod(hostObj: any, method: string, ...args: any[]): any;
    deleteHostObject(hostObj: any): void;
};