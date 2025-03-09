import JexlAst from "jexl/Ast";
import JexlGrammar from "jexl/Grammar";
import { namedTypes, builders as b, visit } from "ast-types";
import { ExpressionKind } from "ast-types/gen/kinds";

export function estreeFromJexlAst(
  grammar: JexlGrammar,
  ast: JexlAst,
  options: {
    functionParser?: (func: string) => namedTypes.File;
    translateTransforms?: Record<
      string,
      (value: ExpressionKind, ...args: ExpressionKind[]) => ExpressionKind
    >;
    translateFunctions?: Record<
      string,
      (...args: ExpressionKind[]) => ExpressionKind
    >;
  } = {},
  ancestors: JexlAst[] = []
): ExpressionKind {
  const recur = (childAst: JexlAst) =>
    estreeFromJexlAst(grammar, childAst, options, [...ancestors, ast]);

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
      // Check for overrides for functions/transform implementations
      switch (ast.pool) {
        case "transforms":
          {
            const translate = options.translateTransforms?.[ast.name];
            if (translate) {
              return translate(
                recur(ast.args[0]),
                ...ast.args.slice(1).map(recur)
              );
            }
          }
          break;
        case "functions":
          {
            const translate = options.translateFunctions?.[ast.name];
            if (translate) {
              return translate(...ast.args.map(recur));
            }
          }
          break;
      }

      // Check Jexl custom functions/transforms for an implementation
      if (options.functionParser) {
        let functionBodyAst: namedTypes.Statement | undefined = (() => {
          switch (ast.pool) {
            case "transforms":
              {
                const transform = grammar.transforms[ast.name];
                if (transform) {
                  return options.functionParser(transform.toString()).program
                    .body;
                }
              }
              break;
            case "functions":
              {
                const func = grammar.functions[ast.name];
                if (func) {
                  return options.functionParser(func.toString()).program.body;
                }
              }
              break;
          }
        })()?.[0];

        if (functionBodyAst) {
          // If the function body is an expression statement, unwrap it
          if (namedTypes.ExpressionStatement.check(functionBodyAst)) {
            functionBodyAst = functionBodyAst.expression;
          }

          if (
            namedTypes.ArrowFunctionExpression.check(functionBodyAst) ||
            namedTypes.FunctionDeclaration.check(functionBodyAst)
          ) {
            const functionParams = functionBodyAst.params;
            const functionBody = functionBodyAst.body;

            // Replace occurrences of the parameter in the function body
            // with the corresponding argument
            for (let i = 0; i < functionParams.length; i++) {
              const functionParam = functionParams[i];
              if (namedTypes.Identifier.check(functionParam)) {
                visit(functionBody, {
                  visitIdentifier(path) {
                    if (path.node.name === functionParam.name) {
                      return recur(ast.args[i]);
                    }
                    this.traverse(path);
                  },
                });
              }
            }

            if (namedTypes.BlockStatement.check(functionBody)) {
              // If the function is just a return statement, unwrap it
              if (functionBody.body.length === 1) {
                const expression = functionBody.body[0];
                if (namedTypes.ReturnStatement.check(expression)) {
                  return expression.argument!;
                }
              }
              // Otherwise, wrap the statements in an arrow function
              return b.callExpression(
                b.arrowFunctionExpression([], functionBody),
                []
              );
            }

            return functionBody;
          }
        }
      }

      return b.callExpression(b.identifier(ast.name), ast.args.map(recur));
  }
}
