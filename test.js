async function test1() {
    try {
        const f = await require('./index')(`
            return (async () => {
                arguments[1]();
                await arguments[0]();
                arguments[1]();
            })()
        `);
        console.log('done', await f(async () => {
            try {
                console.log('before');
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('after');
            } catch(e) {
                console.log('caught', e);
            }
        }, (s) => {
            console.log('!!! ' + s)
        }));
        console.log('~~~');
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