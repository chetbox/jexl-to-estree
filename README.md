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

const jexl = new Jexl();
const compiledExpression = jexl.compile("foo.bar ^ 2 == 16");
const ast = estreeFromJexlAst(jexl._grammar, compiledExpression._getAst());
recast.print(ast).code; // "Math.pow(foo.bar, 2) === 16"
```
