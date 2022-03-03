async function test1() {
    try {
        const f = await require('./index')(`
            return (async () => {
                await arguments[0]();
                return 'hello';
            })()
        `);
        console.log('done', await f(async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }, (s) => {
            console.log('!!! ' + s)
        }));
    } catch(e) {
        console.log(e);
    }
}

async function test2() {
    const f = await require('./index')(`
        return 'hello'
    `);
    console.log('done', f());
}

test1();