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
    const ctx = context();
    const f = await ctx.def(`
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
    const ctx = context({
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
    const ctx = context();
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
    const ctx = context({
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
    const ctx = context({ global: { 
        setTimeout: (cb, ms) => {
            setTimeout(cb, ms)
        },
        console
    }});
    const f = await ctx.def(`
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
    const ctx = context({ global: { 
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
    const f = await ctx.def(`
    let a = {};
    a.b = a;
    console.log('hello', a);
    `)
    f();
    ctx.dispose();
}

async function test13() {
    const { context } = require('./index.node');
    const ctx = context({ global: { 
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
    const ctx = context({ global: { 
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
}

main();