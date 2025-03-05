import JexlAst from "jexl/Ast";
import JexlGrammar, { Element as JexlElement } from "jexl/Grammar";
import { builders as b, ASTNode } from "ast-types";
import { ExpressionKind } from "ast-types/gen/kinds";

export function estreeFromJexlAst(
  grammar: JexlGrammar,
  ast: JexlAst,
  ancestors: JexlAst[] = []
): ExpressionKind {
  const recur = (childAst: JexlAst) =>
    estreeFromJexlAst(grammar, childAst, [...ancestors, ast]);

  switch (ast.type) {
    case "Literal":
      return b.literal(ast.value);

    case "Identifier":
      if (ast.from) {
        return b.memberExpression(
          recur(ast.from),
          b.identifier(ast.value),
          false
        );
      } else {
        return b.identifier(ast.value);
      }
    case "UnaryExpression":
      return b.unaryExpression(ast.operator as any, recur(ast.right));
    // TODO: check for other unary expressions in grammar?
    case "BinaryExpression":
      switch (ast.operator) {
        case "&&":
        case "||":
          return b.logicalExpression(
            ast.operator,
            recur(ast.left),
            recur(ast.right)
          );
        case "===":
        case "!==":
        case "<":
        case "<=":
        case ">":
        case ">=":
        case "<<":
        case ">>":
        case ">>>":
        case "+":
        case "-":
        case "*":
        case "/":
        case "%":
        case "&":
        case "|":
        case "in":
        case "instanceof":
        case "**":
          return b.binaryExpression(
            ast.operator,
            recur(ast.left),
            recur(ast.right)
          );
        case "==":
        case "!=":
          return b.binaryExpression(
            ast.operator === "==" ? "===" : "!==",
            recur(ast.left),
            recur(ast.right)
          );
        case "^":
          return b.callExpression(
            b.memberExpression(
              b.identifier("Math"),
              b.identifier("pow"),
              false
            ),
            [recur(ast.left), recur(ast.right)]
          );
        case "//":
          return b.callExpression(
            b.memberExpression(
              b.identifier("Math"),
              b.identifier("floor"),
              false
            ),
            [b.binaryExpression("/", recur(ast.left), recur(ast.right))]
          );
        default:
          throw new Error("Unknown binary operator: " + ast.operator);
        // TODO: Look for other operators in the grammar?
      }
    case "ConditionalExpression":
      return b.conditionalExpression(
        recur(ast.test),
        recur(ast.consequent),
        recur(ast.alternate)
      );
    case "ArrayLiteral":
      return b.arrayExpression(ast.value.map(recur));
    case "ObjectLiteral":
      return b.objectExpression(
        Object.entries(ast.value).map(([key, value]) =>
          b.objectProperty(b.identifier(key), recur(value))
        )
      );
    case "FilterExpression":
      if (ast.relative) {
        return b.callExpression(
          b.memberExpression(recur(ast.subject), b.identifier("filter")),
          [
            b.arrowFunctionExpression(
              [
                b.objectPattern([
                  b.property.from({
                    kind: "init",
                    key: b.identifier("bar"),
                    value: b.identifier("bar"),
                    shorthand: true,
                  }),
                ]),
              ],
              recur(ast.expr)
            ),
          ]
        );
      } else {
        if (ast.expr.type === "Literal" || ast.expr.type === "Identifier") {
          // We are just indexing into an object/array
          return b.memberExpression(recur(ast.subject), recur(ast.expr), true);
        } else {
          return b.callExpression(
            b.memberExpression(recur(ast.subject), b.identifier("filter")),
            [b.arrowFunctionExpression([], recur(ast.expr))]
          );
        }
      }
    case "FunctionCall":
      return b.callExpression(b.identifier(ast.name), ast.args.map(recur));
  }
}
