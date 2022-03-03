let nextId = 1;

module.exports = async function (script) {
    const wasm = require('./eval')();
    await wasm.ready;
    wasm.dispatch = (encodedAction, encodedKey, encodedArgs) => {
        const action = decodePtrString(wasm, encodedAction);
        const key = decodePtrString(wasm, encodedKey);
        const args = JSON.parse(decodePtrString(wasm, encodedArgs));
        return wasm[key][action](args);
    }
    return function (...args) {
        const key = `key${nextId++}`;
        let syncResult = undefined;
        wasm[key] = {
            invoke(invokeArgs) {
                const result = args[invokeArgs.slot](...invokeArgs.args);
                // eval.c dispatch will free this memory
                return encodeString(wasm, JSON.stringify(result));
            },
            setSyncResult(result) {
                syncResult = result;
                return 0;
            }
        };
        const pScript = encodeString(wasm, `
            const __key = '${key}';
            const __args = ${JSON.stringify(args.map(arg => typeof arg === 'function' ? { __f__: true } : arg))};
            function f() {
                ${script}
            }
            function decodeArg(arg, i) {
                // the argument is a function
                if (arg && arg.__f__) {
                    return function(...args) {
                        return __dispatch('invoke', __key, JSON.stringify({slot:i, args}));
                    }
                }
                return arg;
            }
            try {
                const result = f.apply(undefined, __args.map((arg, i) => decodeArg(arg, i)));
                __dispatch('setSyncResult', __key, JSON.stringify({ success: result }));
            } catch(e) {
                __dispatch('setSyncResult', __key, JSON.stringify({ failure: "" + e }));
            }
            `);
        try {
            const pError = wasm._eval(pScript)
            if (pError) {
                throw new Error(decodePtrString(wasm, pError));
            }
            if (!syncResult) {
                throw new Error('internal error: missing sync result');
            }
            if (syncResult.error) {
                throw new Error(syncResult.error);
            }
            return syncResult.success;
        } finally {
            delete wasm[key];
            wasm._free(pScript);
        }
    }
}

function encodeString(wasm, string) {
    var octets = [];
    var length = string.length;
    var i = 0;
    while (i < length) {
        var codePoint = string.codePointAt(i);
        var c = 0;
        var bits = 0;
        if (codePoint <= 0x0000007F) {
            c = 0;
            bits = 0x00;
        } else if (codePoint <= 0x000007FF) {
            c = 6;
            bits = 0xC0;
        } else if (codePoint <= 0x0000FFFF) {
            c = 12;
            bits = 0xE0;
        } else if (codePoint <= 0x001FFFFF) {
            c = 18;
            bits = 0xF0;
        }
        octets.push(bits | (codePoint >> c));
        c -= 6;
        while (c >= 0) {
            octets.push(0x80 | ((codePoint >> c) & 0x3F));
            c -= 6;
        }
        i += codePoint >= 0x10000 ? 2 : 1;
    }
    octets.push(0);
    const ptr = wasm._malloc(octets.length);
    wasm.HEAP8.set(octets, ptr);
    return ptr;
}

function decodePtrString(wasm, ptr) {
    const octets = wasm.HEAP8.subarray(ptr);
    var string = "";
    var i = 0;
    while (i < octets.length) {
        var octet = octets[i];
        var bytesNeeded = 0;
        var codePoint = 0;
        if (octet <= 0x7F) {
            bytesNeeded = 0;
            codePoint = octet & 0xFF;
        } else if (octet <= 0xDF) {
            bytesNeeded = 1;
            codePoint = octet & 0x1F;
        } else if (octet <= 0xEF) {
            bytesNeeded = 2;
            codePoint = octet & 0x0F;
        } else if (octet <= 0xF4) {
            bytesNeeded = 3;
            codePoint = octet & 0x07;
        }
        if (octets.length - i - bytesNeeded > 0) {
            var k = 0;
            while (k < bytesNeeded) {
                octet = octets[i + k + 1];
                codePoint = (codePoint << 6) | (octet & 0x3F);
                k += 1;
            }
        } else {
            codePoint = 0xFFFD;
            bytesNeeded = octets.length - i;
        }
        if (codePoint === 0) {
            break;
        }
        string += String.fromCodePoint(codePoint);
        i += bytesNeeded + 1;
    }
    return string
}