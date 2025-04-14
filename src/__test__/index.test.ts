import { Jexl } from "jexl";
import * as recast from "recast";
import { describe, expect, test } from "vitest";
import { estreeFromJexlAst, estreeFromJexlString } from "..";
import * as acorn from "acorn";
import { types } from "estree-toolkit";

const jexl = new Jexl();
jexl.addTransforms({
  length: (val) => val.length,
  some: (values, matchValue) => values.some((v) => v === matchValue),
  every: function every(values, matchValue) {
    return values.every((v) => v === matchValue);
  },
  parseInt: (val: string, radix?: number) => parseInt(val, radix),
  fromJSON: (
    jsonString: string,
    reviver?: (this: any, key: string, value: any) => any
  ) => JSON.parse(jsonString, reviver),
  toJSON: (
    obj: unknown,
    replacer?: (this: any, key: string, value: any) => any,
    space?: string | number
  ) => JSON.stringify(obj, replacer, space),
  floor: (value: number) => Math.floor(value),
  ceil: (value: number) => Math.ceil(value),
  round: (value: number) => Math.round(value),
  abs: (value: number) => Math.abs(value),
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
  ["foo .bar .baz", "foo?.bar?.baz"],
  ['foo["bar"].baz', 'foo?.["bar"]?.baz'],
  ["foo  ? bar  : baz", "foo ? bar : baz"],
  ["{ one: a.value, two: b.value }", "{\n  one: a?.value,\n  two: b?.value\n}"],
  ["! foo", "!foo"],
  ["foo.bar   ==   foo.baz", "foo?.bar === foo?.baz"],
  ['[true,"two",3]', '[true, "two", 3]'],
  ["foo[.bar == 3]", "foo?.filter((\n  {\n    bar\n  }\n) => bar === 3)"],
  ["foo[bar == 3]", "foo?.[bar === 3]"],
  ['foo[bar + "baz"]', 'foo?.[bar + "baz"]'],
  ["foo | bar | baz(1, 2)", "baz(bar(foo), 1, 2)"],
  ["baz(bar(foo), 1, 2)", null],
  ["1 + (2 * 3)", "1 + 2 * 3"],
  ["(1 + 2) * 3", null],
  ["1 + 2 + 3 - 3 - 2 - 1", null],
  ["a ^ 3", "a ** 3"],
  ["b // 10", "Math.floor(b / 10)"],
  [
    '1 // 2 * (foo["bar"] - 4) % 6 ^ foo[.bar == 1 * 2 * 3]',
    'Math.floor(1 / 2) * ((foo?.["bar"] - 4) % 6) ** foo?.filter((\n  {\n    bar\n  }\n) => bar === 1 * 2 * 3)',
  ],
  ["3 in [1, 2, 3]", "[1, 2, 3].includes(3)"],
  ['"a" in ["a", "b", "c"]', '["a", "b", "c"].includes("a")'],
  ['"a" in list', 'list?.includes("a")'], // `list` may be undefined
  ["a.b[e.f].c[g.h].d", "a?.b?.[e?.f]?.c?.[g?.h]?.d"],
  ["a[c][d].b", "a?.[c]?.[d]?.b"],
  ["(a ? b : c) + (d && (e || f))", null],
  ["!a", null],
  ["!(a && b)", null],
  ["!a[b]", "!a?.[b]"],
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
  ["MyObjectWhichIsAlwaysDefined.MyObjectWhichIsAlwaysDefined.foo", null], // Custom global object which doesn't use optional chaining

  // Transforms
  ["x | length", "x?.length"], // uses `length` transform to convert expression
  [
    "MyArrayWhichIsAlwaysDefined | length",
    "MyArrayWhichIsAlwaysDefined.length",
  ], // uses `length` transform to convert expression
  ["[1,2,3] | length", "[1, 2, 3].length"], // uses `length` transform to convert expression
  ["[1,2,3] | some(1)", "[1, 2, 3].some((v) => v === 1)"], // uses `some` transform to convert expression
  ["[1,2,3] | every(1)", "[1, 2, 3].every((v) => v === 1)"], // uses `every` transform to convert expression - unwraps function block
  ['"1234" | parseInt', 'parseInt("1234")'], // uses `parseInt` transform to convert expression with no argument
  ['"abcd" | parseInt(16)', 'parseInt("abcd", 16)'], // uses `parseInt` transform to convert expression with argument
  ['"1234" | parseInt(16, "nonsense")', 'parseInt("1234", 16)'], // `parseInt` transform extra argument ignored
  ["'{a: 123}' | fromJSON | toJSON", 'JSON.stringify(JSON.parse("{a: 123}"))'], // uses `fromJSON` and `toJSON` transforms to convert expression
  ["x | toJSON(null, 2)", "JSON.stringify(x, null, 2)"], // uses `toJSON` transform with arguments
  ["(x / 1000) | floor", "Math.floor(x / 1000)"], // uses `floor` transform to convert expression

  // Functions
  ["now() + 1000", "Date.now() + 1000"], // uses `now` function to convert expression
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

  // Unary operators
  ["!foo", null], // unary operator
  ["~foo", "!!foo"], // custom unary operator

  // Binary operators
  ["'hello' <> 'world'", '"hello" + "world"'], // uses `..` custom binary operator
  ["5 .. 15", "new Array(15 - 5).fill(0)?.map((_, i) => 5 + i)"], // uses `..` custom binary operator
  [
    '[{ direction: "Right", clicks: 1}, { direction: "Left", clicks: 2 }]',
    '[{\n  direction: "Right",\n  clicks: 1\n}, {\n  direction: "Left",\n  clicks: 2\n}]',
  ], // array of objects
];

const FUNCTION_PARSERS = {
  recast: (source: string) => recast.parse(source).program,
  acorn: (source: string) =>
    acorn.parse(source, {
      ecmaVersion: 2021,
      sourceType: "script",
    }) as types.Program,
};

const ECMASCRIPT_SERIALIZERS = {
  recast: (ast: types.Node) =>
    recast.print(ast, {
      tabWidth: 2,
      arrowParensAlways: true,
    }).code,
};

describe.each(TEST_CASES)("%s", (input, expected) => {
  describe.each(Object.entries(FUNCTION_PARSERS))(
    "%s parser",
    (_parserName, functionParser) => {
      describe.each(Object.entries(ECMASCRIPT_SERIALIZERS))(
        "%s serializer",
        (_serializerName, serializeToString) => {
          const options = {
            functionParser,
            translateTransforms: TRANSLATE_TRANSFORMS,
            translateFunctions: TRANSLATE_FUNCTIONS,
            isIdentifierAlwaysDefined: (identifier: string[]) => {
              switch (identifier.length) {
                case 1:
                  return (
                    identifier[0] === "console" ||
                    identifier[0] === "MyArrayWhichIsAlwaysDefined" ||
                    identifier[0] === "MyObjectWhichIsAlwaysDefined"
                  );
                case 2:
                  return (
                    identifier[0] === "MyObjectWhichIsAlwaysDefined" &&
                    identifier[1] === "MyObjectWhichIsAlwaysDefined"
                  );
              }
              return false;
            },
          };

          test("estreeFromJexlString", () => {
            const estreeAst = estreeFromJexlString(jexl, input, options);
            const newExpression = serializeToString(estreeAst);
            expect(newExpression).toBe(expected ?? input);
          });

          test("estreeFromJexlAst", () => {
            const compiledExpression = jexl.compile(input);
            const estreeAst = estreeFromJexlAst(
              jexl._grammar,
              compiledExpression._getAst(),
              options
            );
            const newExpression = serializeToString(estreeAst);
            expect(newExpression).toBe(expected ?? input);
          });
        }
      );
    }
  );
});
