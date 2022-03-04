const def = require('./index')

async function test1() {
    try {
        const f = await def(`
            return (async () => {
                await arguments[0]();
                return 'hello1';
            })()
        `);
        console.log('done', await f(async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }, (s) => {
            console.log('!!! ' + s)
        }));
    } catch (e) {
        console.log(e);
    }
}

async function test2() {
    const f = await def(`
        return 'hello'
    `);
    console.log('done', f());
}

async function test3() {
    const f = await def(`
    const [print, sleep] = arguments;
    return (async() => {
        print('hello')
        await sleep(5000);
        print('world')
    })()
    `)
    f(
        msg => console.log(msg),
        milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
    )
}

test3();