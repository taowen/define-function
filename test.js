async function test1() {
    const f = await require('./index')(`
        const [hello, world] = arguments;
        return hello + ', ' + world;
    `);
    console.log(f('hello', 'world'));
}

test1();