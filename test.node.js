const def = require('./index.node')
const assert = require('assert');

async function test1() {
    const f = await def(`
    return 'hello';
    `)
    f();
    if (f() !== 'hello') {
        assert.fail()
    }
}

async function test2() {
    const f = await def(`
    throw 'hello';
    `)
    let ex;
    try {
        f()
    } catch (e) {
        ex = e;
    }
    if (!ex) {
        assert.fail();
    }
}

async function test3() {
    const f = await def(`
    const [hello, world] = arguments;
    return hello + ' ' + world;
    `)
    if (f('hello', 'world') !== 'hello world') {
        assert.fail();
    }
}

async function test4() {
    const f = await def(`
        return new Date().toString();
    `)
    if (typeof f() !== 'string') {
        assert.fail();
    }
}

async function test5() {
    const f = await def(`
    const [print, sleep] = arguments;
    return (async() => {
        print('hello')
        await sleep(1000);
        print('world')
    })()
    `)
    await f(
        msg => console.log(msg),
        milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
    )
}

async function test6() {
    const { context } = require('./index.node');
    const ctx = await context();
    const f = ctx.def(`
    global.counter = (global.counter || 0)+1;
    return counter;
    `)
    if (f() !== 1) {
        assert.fail()
    }
    if (f() !== 2) {
        assert.fail()
    }
    if (f() !== 3) {
        assert.fail()
    }
    ctx.dispose();
}

async function test7() {
    const f = await def(`
    return (async() => {
        return await import('sideFile.js');
    })()
    `, {
        async loadModuleContent(moduleName) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return `export default 'hello'`;
        }
    })
    if ((await f()).default !== 'hello') {
        assert.fail();
    }
}

async function test8() {
    const { context } = require('./index.node');
    const ctx = await context({
        async loadModuleContent(moduleName) {
            if (moduleName === 'xxx') {
                return `export default 'hello'`
            } else {
                return '';
            }
        },
        global: {
            console
        }
    });
    await ctx.load(`
    import * as xxx from 'xxx';
    console.log(import.meta, xxx)`, {
        filename: 'abc.js',
        meta: {
            blah: 'blah'
        }
    });
    ctx.dispose();
}

async function test9() {
    const { context } = require('./index.node');
    const ctx = await context();
    const { hello, sayHello } = await ctx.load(`
    export const hello = 'world';
    export function sayHello() {
        return 'world'
    }
    `, {
        filename: '<load>'
    });
    if (hello !== 'world') {
        assert.fail();
    }
    if (await sayHello() !== 'world') {
        assert.fail();
    }
    ctx.dispose();
}

async function test10() {
    const { context } = require('./index.node');
    const ctx = await context({
        loadModuleContent(moduleName) {
            if (moduleName !== 'someDir/b.js') {
                assert.fail();
            }
            return `export const msg = 'hello';`
        }
    });
    const { result } = await ctx.load(`
    import { msg } from '../b.js'
    export const result = msg;
    `, {
        filename: 'someDir/someSubDir/a.js'
    });
    if (result !== 'hello') {
        assert.fail();
    }
    ctx.dispose();
}

async function test11() {
    const { context } = require('./index.node');
    const ctx = await context({ global: { 
        setTimeout: (cb, ms) => {
            setTimeout(cb, ms)
        },
        console
    }});
    const f = ctx.def(`
    setTimeout(() => {
        console.log('callback');
    }, 0);
    `)
    f();
    await new Promise(resolve => setTimeout(resolve, 100));
    ctx.dispose();
}

async function test12() {
    const { context } = require('./index.node');
    const ctx = await context({ global: { 
        console
    }});
    await ctx.load(`
    const consoleLog = console.log;
    global.console.log = (...args) => {
        try {
            JSON.stringify(args)
        } catch(e) {
            consoleLog('ignore console.log with data that can not JSON.stringify: ' + e);
            return;
        }
        consoleLog(...args);
    }`);
    const f = ctx.def(`
    let a = {};
    a.b = a;
    console.log('hello', a);
    `)
    f();
    ctx.dispose();
}

async function test13() {
    const { context } = require('./index.node');
    const ctx = await context({ global: {
        someCallback() {
            console.log(ctx.currentStack);
        }
    }});
    await ctx.load(`
    function someFunction() {
        someCallback()
    }
    __s__.inspect('someObj', { a: 'b' });
    someFunction();
    `);
    ctx.dispose();
}

async function test14() {
    const { context } = require('./index.node');
    const ctx = await context({ global: { 
        console,
        wx: {
            request(options) {
                options.success('hello');
            }
        }
    }});
    await ctx.load(`
    wx.request({
        url: 'http://baidu.com',
        success(data) {
            console.log(data);
        }
    })
    `);
    ctx.dispose();
}

async function test15() {
    const { context } = require('./index.node');
    const ctx = await context();
    ctx.inject('wx', {
        createSelectorQuery: ctx.wrapHostFunction(() => {
            return {
                select(selector) {
                    return { selector };
                }
            }
        }, { returnsHostObject: true })
    })
    const ret = ctx.def(`
    const query = wx.createSelectorQuery();
    try {
        const ret = __s__.callMethod(query, 'select', '#the-id');
        try {
            return __s__.getProp(ret, 'selector');
        } finally {
            __s__.deleteHostObject(ret);
        }
    } finally {
        __s__.deleteHostObject(query);
    }
    `)();
    if (ret !== '#the-id') {
        assert.fail();
    }
    ctx.dispose();
}

async function test16() {
    const { context } = require('./index.node');
    const ctx = await context();
    // should not save to global.cb, as arguments[0] will be disposed
    await ctx.def(`global.cb = arguments[0]`)(() => 100);
    try {
        ctx.def(`return cb()`)()
    } catch(e) {
        // Error: host function not found: {"__h__":10,"argIndex":0}
        if (!e.message.includes('argIndex')) {
            assert.fail();
        }
    }
    ctx.dispose();
}

async function test17() {
    const { context } = require('./index.node');
    const ctx = await context({
        global: {
            setTimeout(cb) {
                if(cb() !== 100) {
                    assert.fail();
                }
                try {
                    cb();
                } catch(e) {
                    // Error: callback {"__c__":1,"once":true} can only be callback once, if need to callback multiple times, use __s__.wrapCallback to manage callback lifetime explicitly
                    if (!e.message.includes('manage callback lifetime explicitly')) {
                        e.fail();
                    }
                }
            }
        }
    });
    await ctx.load(`setTimeout(() => 100)`);
    ctx.dispose();
}

async function test18() {
    const { context } = require('./index.node');
    const ctx = await context({ global: { console }});
    ctx.inject('global', {
        createABC: ctx.wrapHostFunction(() => {
            return { val: 100 }
        }, { returnsHostObject: true }),
        useABC: (arg) => {
            if (arg?.val !== 100) {
                assert.fail();
            }
        }
    })
    await ctx.load(`
        useABC(createABC());
    `);
    ctx.dispose();
}

async function main() {
    await Promise.all([test1(), test2(), test3(), test4(), test6()])
    await test5();
    await test7();
    await test8();
    await test9();
    await test10();
    await test11();
    await test12();
    await test13();
    await test14();
    await test15();
    await test16();
    await test17();
    await test18();
}

main();