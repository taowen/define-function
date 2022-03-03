async function test1() {
    const f = await require('./index')(`
        return arguments[0]();
    `);
    console.log(f(() => 'hello'));
}

test1();