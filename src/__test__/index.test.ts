import { estreeFromJexlAst } from "..";
import { Jexl } from "jexl";
import * as recast from "recast";

describe("estreeFromJexlAst", () => {
  // Create a Jexl AST from an expression and then convert back to an expression and see if it looks right

  const expressions: [string, string | null][] = [
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
    ["foo[bar == 3]", "foo.filter(() => bar === 3)"],
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
  ];

  test.each(expressions)("`%s`", (input, expected) => {
    const jexl = new Jexl();
    const compiledExpression = jexl.compile(input);
    const estreeAst = estreeFromJexlAst(
      jexl._grammar,
      compiledExpression._getAst()
    );
    const newExpression = recast.print(estreeAst, { tabWidth: 2 }).code;
    expect(newExpression).toBe(expected ?? input);
  });
});
