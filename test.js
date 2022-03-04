const def = require('./index.node')
const assert = require('assert');

async function test1() {
    const f = await def(`
    return 'hello';
    `)
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

async function main() {
    await Promise.all([test1(), test2(), test3(), test4()])
    await test5();
}

main();