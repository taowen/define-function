const def = require('./index.browser')

async function main() {
    const f = await def(`
        return 'hello';
    `)
    console.log(f());
}

main();