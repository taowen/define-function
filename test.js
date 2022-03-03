async function test1() {
    const f = await require('./index')(`
        const [hello, world] = arguments;
        return hello + ', ' + world(100);
    `);
    console.log(f('hello', (i) => 'world~~~' + i));
}

test1();