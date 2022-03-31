type callbackToken = { __brand: 'callbackToken' }
declare const __s__: {
    wrapCallback(f: Function): callbackToken;
    invokeCallback(callbackToken: callbackToken, args: any[]): any;
    deleteCallback(callbackToken: callbackToken);
};