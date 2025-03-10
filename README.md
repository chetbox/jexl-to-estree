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

## Example

```ts
import { estreeFromJexlAst } from "jexl-to-estree";
import { Jexl } from "jexl";
import * as recast from "recast";
import { builders as b } from "ast-types";

const jexl = new Jexl();
jexl.addTransforms({
  length: (val) => val.length,
  some: (values, matchValue) => values.some((v) => v === matchValue),
});
jexl.addFunction("now", () => Date.now());

// JEXL built-ins are converted to ECMAScript equivalents
{
  const jexlSrc = "foo.bar ^ 2 == 16";
  const ast = estreeFromJexlAst(jexl._grammar, jexl.compile(jexlSrc)._getAst());
  recast.print(ast).code; // "Math.pow(foo.bar, 2) === 16"
}

// Transforms are automatically converted from `addTransforms`
{
  const jexlSrc = "[1,2,3] | length";
  const ast = estreeFromJexlAst(jexl._grammar, jexl.compile(jexlSrc)._getAst());
  recast.print(ast).code; // "[1, 2, 3].length"
}
{
  const jexlSrc = "[1,2,3] | some(1)";
  const ast = estreeFromJexlAst(jexl._grammar, jexl.compile(jexlSrc)._getAst());
  recast.print(ast).code; // "[1, 2, 3].some((v) => v === 1)"
}

// Functions are automatically converted from `addFunction`
{
  const jexlSrc = "now() + 1000";
  const ast = estreeFromJexlAst(jexl._grammar, jexl.compile(jexlSrc)._getAst());
  recast.print(ast).code; // "Date.now() + 1000"
}

// Handle a function call or transform explicitly
{
  const options = {
    // Parse functions and transforms from the JEXL grammar
    functionParser: recast.parse,

    // Custom output code for specific Jexl transforms
    translateTransforms: {
      prefix: (value: string, arg: string) => arg + value,
    },

    // Custom output for specific Jexl function calls
    translateFunctions: {
      dateString: (value) => new Date(value).toString(),
    },
  };

  const jexlSrc = "dateString() | prefix('Date: ')";
  const ast = estreeFromJexlAst(
    jexl._grammar,
    jexl.compile(jexlSrc)._getAst(),
    options
  );
  recast.print(ast).code; // "'Date: ' + new Date().toString()"
}
```
