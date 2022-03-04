import def from "define-function";

async function main() {
    const f = await def(`
        return 'hello'
    `)
    f();
}

main();