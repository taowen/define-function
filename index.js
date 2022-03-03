module.exports = async function() {
    const wasm = require('./eval')();
    await wasm.ready;
    Object.assign(wasm, {
        CallBack() {
            console.log('!!! called');
        }
    })
    const pool = new ObjectPool(wasm);
    try {
        const pScript = pool.encodeString('msg("hello world")');
        console.log(decodePtrString(wasm.HEAP8, wasm._eval(pScript)));
    } finally {
        pool.dispose();
    }
}

class ObjectPool {
    wasm;
    ptrs = [];

    constructor(wasm) {
        this.wasm = wasm;
    }

    encodeString(string) {
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
        const ptr = this.malloc(octets.length);
        this.wasm.HEAP8.set(octets, ptr);
        return ptr;
    }

    malloc(bytesCount) {
        const ptr = this.wasm._malloc(bytesCount);
        this.ptrs.push(ptr);
        return ptr;
    }

    dispose() {
        for (const ptr of this.ptrs) {
            this.wasm._free(ptr);
        }
        this.ptrs.length = 0;
    }
}

function decodePtrString(HEAP8, ptr) {
    const octets = HEAP8.subarray(ptr);
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