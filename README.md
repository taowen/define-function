# About

quick.js based eval

```
npm install define-function
```

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
    print('hello')
})()
`)
f((msg) => {
    console.log(msg)
}, (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}) 
// 'hello' 
// 'world
```