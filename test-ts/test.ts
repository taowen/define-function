import def from "define-function";

async function main() {
    const ctx = def.context();
    const f = await ctx.def(`
        return 'hello'
    `)
    f();
    ctx.dispose();
}

main();