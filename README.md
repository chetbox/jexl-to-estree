# `jexl-to-estree`

Convert a [Jexl](https://github.com/TomFrost/Jexl) Abstract Syntax Tree (AST) to an ESTree AST so that it can output as Javascript code.

## Installation

NPM:

```shell
npm install --save jexl-to-estree
```

Yarn:

```shell
yarn add jexl-to-estree
```

## TL;DR

```ts
const jexl = new Jexl();
recast.print(estreeFromJexlString(jexl, "foo.bar ^ 2 == 16")).code; // "foo.bar ** 2 == 16"
```

## Limitations

1. Jexl allows indexing an array of object to get a value from the first object using `.`.
  This is not supported. `[{key:'val'}].key` will be translated to `[{key:'val'}].key` which has different semantics in ECMAScript.
  You should remove all instances of this in your Jexl code before using the library, adding a explicit index into the first item of the array. 
  e.g. `[{key:'val'}][0].key`.
2. `==`, `!=`, `>`, `<`, `>=`, `<=` are translated to their counterparts in ECMAScript but the Jexl type coercion semantics vary a little with ECMAScript. 
  It is assumed that your types match or, at least, the expected type coercion in Jexl matches the result in ECMAScript.
  Test individual cases if you are not sure. Prefer comparing equivalent data types.
  ECMAScript's `===` and `!==` are generally preferred for ease of reasoning about your code, but `==` and `!=` are generated by this library to more closely remember Jexl's type coercion.

## Examples

```ts
import { estreeFromJexlString, estreeFromJexlAst } from "jexl-to-estree";
import { Jexl } from "jexl";
import * as recast from "recast";

const jexl = new Jexl();
jexl.addTransforms({
  length: (val) => val.length,
  some: (values, matchValue) => values.some((v) => v === matchValue),
  fromJSON: (jsonString, reviver) => JSON.parse(jsonString, reviver),
  toJSON: (obj, replacer, space) => JSON.stringify(obj, replacer, space),
});
jexl.addFunction("now", () => Date.now());

// JEXL built-ins are converted to ECMAScript equivalents
{
  const ast = estreeFromJexlString(jexl, "foo.bar ^ 2 == 16");
  recast.print(ast).code; // "foo.bar ** 2 == 16"
}
// or use a JEXL AST
{
  const ast = estreeFromJexlAst(
    jexl._grammar,
    jexl.compile("foo.bar ^ 2 == 16")._getAst()
  );
  recast.print(ast).code; // "foo.bar ** 2 == 16"
}

// Transforms are automatically converted from the source code of `addTransforms`.
// Note that direct references to functions are not supported because the source code from `.toString()`
// is used as the implementations of the transforms.
{
  const ast = estreeFromJexlString(jexl, "[1,2,3] | length");
  recast.print(ast).code; // "[1, 2, 3].length"
}
{
  const ast = estreeFromJexlString(jexl, "x | length");
  recast.print(ast).code; // "x?.length"
}
{
  const ast = estreeFromJexlString(jexl, "[1,2,3] | some(1)");
  recast.print(ast).code; // "[1, 2, 3].some((v) => v === 1)"
}

// Functions are automatically converted from the source code of `addFunction`.
// Note that direct references to functions are not supported because the source code from `.toString()`
// is used as the implementations of the functions.
{
  const ast = estreeFromJexlString(jexl, "now() + 1000");
  recast.print(ast).code; // "Date.now() + 1000"
}

// Handle a function call or transform explicitly
{
  const ast = estreeFromJexlString(jexl, "dateString() | prefix('Date: ')", {
    // Parse functions and transforms from the JEXL grammar
    functionParser: (source) => recast.parse(source).program,

    // Custom output code for specific Jexl transforms
    translateTransforms: {
      prefix: (value: string, arg: string) => arg + value,
      // Transforms can also be passed as a function string.
      // This is useful to avoid compilers and minifiers optimizing your function in unhelpful ways
      suffix: "(value, arg) => value + arg"
    },

    // Custom output for specific Jexl function calls
    translateFunctions: {
      dateString: (value) => new Date(value).toString(),
      // Functions can also be passed as a function string.
      // This is useful to avoid compilers and minifiers optimizing your function in unhelpful ways
      inc: "(value) => value + 1"
    },
  });
  recast.print(ast).code; // "'Date: ' + new Date().toString()"
}
```
