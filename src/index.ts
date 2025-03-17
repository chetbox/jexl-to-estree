import type { Jexl } from "jexl";
import JexlAst from "jexl/Ast";
import JexlGrammar from "jexl/Grammar";
import { namedTypes, builders as b, visit } from "ast-types";
import { ExpressionKind } from "ast-types/gen/kinds";

export interface EstreeFromJexlAstOptions {
  functionParser?: (func: string) =>  namedTypes.Program;
  translateTransforms?: Record<string, (value: any, ...args: any[]) => any>;
  translateFunctions?: Record<string, (...args: any[]) => any>;
}

export function estreeFromJexlString(
  jexl: InstanceType<typeof Jexl>,
  jexlSource: string,
  options?: EstreeFromJexlAstOptions
) {
  return estreeFromJexlAst(
    jexl._grammar,
    jexl.compile(jexlSource)._getAst(),
    options
  );
}

export function estreeFromJexlAst(
  grammar: JexlGrammar,
  ast: JexlAst,
  options: EstreeFromJexlAstOptions = {},
  ancestors: JexlAst[] = []
): ExpressionKind {
  const recur = (childAst: JexlAst) =>
    estreeFromJexlAst(grammar, childAst, options, [...ancestors, ast]);

  const createExpressionFromFunction = (
    func: Function | undefined,
    args: ExpressionKind[]
  ) => {
    if (!func) {
      return undefined;
    }

    let functionBodyAst: namedTypes.Statement | undefined =
      options.functionParser?.(func.toString()).body[0];

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
                  if (i < args.length) {
                    return args[i];
                  } else {
                    return b.identifier("undefined");
                  }
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
  };

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
      switch (ast.operator) {
        case "!":
          return b.unaryExpression("!", recur(ast.right));
        default: {
          // Find custom unary operators in the grammar
          const unaryOperator = grammar.elements[ast.operator];
          if (unaryOperator?.type === "unaryOp" && unaryOperator.eval) {
            const newAstFromFunction = createExpressionFromFunction(
              unaryOperator.eval,
              [recur(ast.right)]
            );
            if (newAstFromFunction) {
              return newAstFromFunction;
            }
          }
          throw new Error("Unknown unary operator: " + ast.operator);
        }
      }
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
          // Find custom binary operators in the grammar
          {
            const binaryOperator = grammar.elements[ast.operator];
            if (binaryOperator?.type === "binaryOp" && binaryOperator.eval) {
              const newAstFromFunction = createExpressionFromFunction(
                binaryOperator.eval,
                [recur(ast.left), recur(ast.right)]
              );
              if (newAstFromFunction) {
                return newAstFromFunction;
              }
            }
          }
          throw new Error("Unknown binary operator: " + ast.operator);
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
      // Check for overrides, then Jexl grammar, for functions/transform implementations
      const newAstFromFunction = (() => {
        switch (ast.pool) {
          case "transforms":
            return createExpressionFromFunction(
              options.translateTransforms?.[ast.name] ??
                grammar.transforms[ast.name],
              ast.args.map(recur)
            );
          case "functions":
            return createExpressionFromFunction(
              options.translateFunctions?.[ast.name] ??
                grammar.functions[ast.name],
              ast.args.map(recur)
            );
        }
      })();

      return (
        newAstFromFunction ??
        b.callExpression(b.identifier(ast.name), ast.args.map(recur))
      );
  }
}
