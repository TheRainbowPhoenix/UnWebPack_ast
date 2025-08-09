# UWP - UnWebPack

A simple tool to slice out (and clean some) content of webpack bundled js.
Mainly useful for webapp analysis and RE. Tool I use a lot.

It made it easier to copy paste chunk to LLM and ask them what the lib is (try this with chatGPT, pretending it's a game like `small game ! Can you guess from which js library that was compiled ? <CODE HERE>` and it should work)

## Usage
The main app is node js, but because it's old and I don't do much node anymore I rewrote and updated it to `deno`, check the subfolder. Please install deno. Do it now. Deno.

Edit the `deno/src/main.ts` :

```ts
async function start() {
  const inFile = "../../flare.rive.app/lib/Nima.75f25c72b5b721e88cb1.js";
  
```

to be te path (relative) to your file. I'm too busy to implement a proper cli, plus it make it easier to debug (no, I just don't want to bother with writing a CLI)

Then, run `deno task start` and let it fill the "out" folder.

Good, you can now go explore. Have fun.

## Explore graph
Additionally, you can generate some json to browse the dependencies. It is bad but works : `deno task graph`.
It will generate `dependency-graph.json`. Rename it to whatever, then you can use the "dg.html" to open and view its content. It's nice. It should help a bit.

## Auto name imports
Take a look at `webpack-aliases.jsonc`. Basically a JSON with comments, where you can drop the chunk id and the name of the var :
```jsonc
{
    "0":"React", // React 16.14.0
    "2": "glMatrix", // 'gl-matrix'
}
```

Will do the cool :
```js
const glMatrix = __webpack_require__(2);
```

instead of just the boring `const import_e = ...`. It renames across all file. You're welcome. 

