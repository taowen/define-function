# About

[quick.js](https://bellard.org/quickjs/) based sandbox

```
npm install define-function
```

works in any WebAssembly environment

* node
* browser
* wechat miniprogram

# Usage

define a function dynamically with javascript source code

```js
const def = require('define-function')
const f = await def(`
    return 'hello';
`)
f() // 'hello'
```

function can have argument

```js
const def = require('define-function')
const f = await def(`
    const [hello, world] = arguments;
    return hello + ' ' + world;
`)
f('hello', 'world') // 'hello world'
```

argument can be function

```js
const def = require('define-function')
const f = await def(`
    const [print] = arguments;
    print('hello')
`)
f((msg) => {
    console.log(msg)
}) // 'hello'
```

argument can be async function

```js
const def = require('define-function')
const f = await def(`
    const [print, sleep] = arguments;
    (async() => {
        print('hello')
        await sleep(1000);
        print('world')
    })();
`)
f(
    msg => console.log(msg),
    milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
) 
// hello
// world
```

can return promise back to host

```js
const def = require('define-function')
const f = await def(`
    const [print, sleep] = arguments;
    return (async() => {
        print('hello')
        await sleep(1000);
        print('world')
    })();
`)
await f(
    msg => console.log(msg),
    milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
)
console.log('done')
// hello
// world
// done
```

share context between multiple invocations

```js
const { context } = require('define-function')
const ctx = context()
const f = await ctx.def(`
    global.counter = (global.counter || 0)+1;
    return counter; // counter can be referenced globally
`)
f() // 1
f() // 2
f() // 3
ctx.dispose()
```

inject value and callbacks into global

```js
const { context } = require('define-function')
const ctx = context({ global: { 
    console,
    anwerOfEverything() {
        return 42;
    }
} }) // inject console and anwerOfEverything to global
const f = await ctx.def(`
    console.log(anwerOfEverything());
`)
f() // 42
ctx.dispose();
```

load es module

```js
const { context } = require('define-function')
const ctx = context({ global: { 
    console,
    anwerOfEverything() {
        return 42;
    }
} }) // inject console and anwerOfEverything to global
const f = await ctx.def(`
    console.log(anwerOfEverything());
`)
f() // 42
ctx.dispose();
```


# Limit

* function argument does not support Set/Map/Class or anything that can not survive JSON.parse(JSON.stringify), except the argument is a function
* function return value does not support Set/Map/Class or anything that can not survive JSON.parse(JSON.stringify), except promise object
* JSON.stringify and JSON.parse takes time, so the arguments and return value should be as small as possible for best performance

# Similar projects

* https://github.com/justjake/quickjs-emscripten/
* https://github.com/maple3142/wasm-jseval

define-function has a simpler API and support async/await
