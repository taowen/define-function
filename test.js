async function test1() {
    const f = await require('./index')(`
        return new Promise(resolve => resolve('hello'));
    `);
    console.log(f());
}

test1();