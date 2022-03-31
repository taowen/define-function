type callbackToken = { __brand: 'callbackToken' }
declare const __s__: {
    wrapCallback(f: Function): callbackToken;
    invokeCallback(callbackToken: callbackToken, args: any[]): any;
    deleteCallback(callbackToken: callbackToken);
    getProp(hostObj: any, prop: string): any;
    setProp(hostObj: any, prop: string, value: any): void;
    callMethod(hostObj: any, method: string, ...args: any[]): any;
    deleteHostObject(...hostObj: any): void;
};