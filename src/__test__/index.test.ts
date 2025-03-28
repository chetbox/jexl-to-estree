import { Jexl } from "jexl";
import * as recast from "recast";
import { describe, expect, test } from "vitest";
import { estreeFromJexlAst, estreeFromJexlString } from "..";

const jexl = new Jexl();
jexl.addTransforms({
  length: (val) => val.length,
  some: (values, matchValue) => values.some((v) => v === matchValue),
  every: function every(values, matchValue) {
    return values.every((v) => v === matchValue);
  },
  parseInt: (val: string, radix?: number) => parseInt(val, radix),
});
jexl.addFunction("now", () => Date.now());
jexl.addFunction("print", (value) => {
  console.log(value);
  return true;
});
jexl.addUnaryOp("~", (value: unknown) => !!value);
jexl.addBinaryOp("<>", 20, (a: string, b: string) => a + b);
jexl.addBinaryOp("..", 20, (a: number, b: number) => {
  return new Array(b - a).fill(0).map((_, i) => a + i);
});

const TRANSLATE_TRANSFORMS = {
  prefix: (value: string, arg: string) => arg + value,
};

const TRANSLATE_FUNCTIONS = {
  dateString: (value) => new Date(value).toString(),
};

const TEST_CASES: [string, string | null][] = [
  ["true", "true"],
  ["'hello world'", '"hello world"'],
  ["123.0", "123"],
  ["-123.0", "-123"],
  ["123456789101112131415161718", "1.2345678910111214e+26"],
  ["-123456789101112131415161718", "-1.2345678910111214e+26"],
  ["8.27936475869709331257", "8.279364758697094"],
  ["-8.27936475869709331257", "-8.279364758697094"],
  ["a != b", "a !== b"],
  ["foo .bar .baz", "foo.bar.baz"],
  ['foo["bar"].baz', null],
  ["foo  ? bar  : baz", "foo ? bar : baz"],
  ["{ one: a.value, two: b.value }", `{\n  one: a.value,\n  two: b.value\n}`],
  ["! foo", "!foo"],
  ["foo.bar   ==   foo.baz", "foo.bar === foo.baz"],
  ['[true,"two",3]', '[true, "two", 3]'],
  ["foo[.bar == 3]", "foo.filter((\n  {\n    bar\n  }\n) => bar === 3)"],
  ["foo[bar == 3]", "foo[bar === 3]"],
  ['foo[bar + "baz"]', null],
  ["foo | bar | baz(1, 2)", "baz(bar(foo), 1, 2)"],
  ["baz(bar(foo), 1, 2)", null],
  ["1 + (2 * 3)", "1 + 2 * 3"],
  ["(1 + 2) * 3", null],
  ["1 + 2 + 3 - 3 - 2 - 1", null],
  ["a ^ 3", "Math.pow(a, 3)"],
  ["b // 10", "Math.floor(b / 10)"],
  [
    '1 // 2 * (foo["bar"] - 4) % 6 ^ foo[.bar == 1 * 2 * 3]',
    'Math.floor(1 / 2) * Math.pow((foo["bar"] - 4) % 6, foo.filter((\n  {\n    bar\n  }\n) => bar === 1 * 2 * 3))',
  ],
  ["3 in [1, 2, 3]", "[1, 2, 3].includes(3)"],
  ['"a" in ["a", "b", "c"]', '["a", "b", "c"].includes("a")'],
  ["a.b[e.f].c[g.h].d", null],
  ["a[c][d].b", null],
  ["(a ? b : c) + (d && (e || f))", null],
  ["!a", null],
  ["!(a && b)", null],
  ["!a[b]", null],
  ["!a ? b : c", null],
  ["!(a ? b : c)", null],
  [
    '(z + 0) + " A " + (a + 1) + " B " + (b + 2) + " C " + (c == 0 ? "c1" : "c2")',
    'z + 0 + " A " + (a + 1) + " B " + (b + 2) + " C " + (c === 0 ? "c1" : "c2")',
  ],
  ["a ? b1 ? b2 : b3 : c1 ? c2 : c3", null],
  ["a < b | c", "a < c(b)"],
  ["a < (b | c) ? true : false", "a < c(b) ? true : false"], // Jexl can't parse this if the brackets are removed
  ["a | b < c ? true : false", "b(a) < c ? true : false"],
  ["[1,2,3] | length", "[1, 2, 3].length"], // uses `length` transform to convert expression
  ["[1,2,3] | some(1)", "[1, 2, 3].some((v) => v === 1)"], // uses `some` transform to convert expression
  ["[1,2,3] | every(1)", "[1, 2, 3].every((v) => v === 1)"], // uses `every` transform to convert expression - unwraps function block
  ['"1234" | parseInt', 'parseInt("1234")'], // uses `parseInt` transform to convert expression with no argument
  ['"abcd" | parseInt(16)', 'parseInt("abcd", 16)'], // uses `parseInt` transform to convert expression with argument
  ['"1234" | parseInt(16, "nonsense")', 'parseInt("1234", 16)'], // `parseInt` transform extra argument ignored
  ["now() + 1000", "Date.now() + 1000"], // uses `now` expression to convert expression
  [
    "dateString(1234567890) | prefix('Date: ')",
    '"Date: " + new Date(1234567890).toString()',
  ], // uses custom function and transform handler
  ["dateString()", "new Date(undefined).toString()"], // uses custom function handler, replacing the missing argument with `undefined`
  ["dateString(1234567890)", "new Date(1234567890).toString()"], // uses custom function with argument
  [
    "print(foo) && bar",
    "(() => {\n  console.log(foo);\n  return true;\n})() && bar",
  ], // uses `print` function block inline
  ["!foo", null], // unary operator
  ["~foo", "!!foo"], // custom unary operator
  ["'hello' <> 'world'", '"hello" + "world"'], // uses `..` custom binary operator
  ["5 .. 15", "new Array(15 - 5).fill(0).map((_, i) => 5 + i)"], // uses `..` custom binary operator
  [
    '[{ direction: "Right", clicks: 1}, { direction: "Left", clicks: 2 }]',
    '[{\n  direction: "Right",\n  clicks: 1\n}, {\n  direction: "Left",\n  clicks: 2\n}]',
  ], // array of objects
];

describe.each(TEST_CASES)("%s", (input, expected) => {
  test("estreeFromJexlString", () => {
    const estreeAst = estreeFromJexlString(jexl, input, {
      functionParser: (source) => recast.parse(source).program,
      translateTransforms: TRANSLATE_TRANSFORMS,
      translateFunctions: TRANSLATE_FUNCTIONS,
    });
    const newExpression = recast.print(estreeAst, { tabWidth: 2 }).code;
    expect(newExpression).toBe(expected ?? input);
  });

  test("estreeFromJexlAst", () => {
    const compiledExpression = jexl.compile(input);
    const estreeAst = estreeFromJexlAst(
      jexl._grammar,
      compiledExpression._getAst(),
      {
        functionParser: (source) => recast.parse(source).program,
        translateTransforms: TRANSLATE_TRANSFORMS,
        translateFunctions: TRANSLATE_FUNCTIONS,
      }
    );
    const newExpression = recast.print(estreeAst, { tabWidth: 2 }).code;
    expect(newExpression).toBe(expected ?? input);
  });
});
