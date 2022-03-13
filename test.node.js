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
        async dynamicImport(filename) {
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
        async dynamicImport(basename, filename) {
            if (filename === 'xxx') {
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

async function main() {
    await Promise.all([test1(), test2(), test3(), test4(), test6()])
    await test5();
    await test7();
    await test8();
    await test9();
}

main();