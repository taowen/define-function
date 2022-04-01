type sandboxFunctionToken = { __brand: 'sandboxFunctionToken' }
declare const __s__: {
    wrapSandboxFunction(f: Function, extra?: { once?: boolean }): sandboxFunctionToken;
    deleteSandboxFunction(token: sandboxFunctionToken);
    getProp(hostObj: any, prop: string): any;
    setProp(hostObj: any, prop: string, value: any): void;
    callMethod(hostObj: any, method: string, ...args: any[]): any;
    deleteHostObject(hostObj: any): void;
};