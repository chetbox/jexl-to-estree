import type { Jexl } from "jexl";
import JexlAst from "jexl/Ast";
import JexlGrammar from "jexl/Grammar";
import { traverse, builders as b, is, types, utils } from "estree-toolkit";

export interface EstreeFromJexlAstOptions {
  functionParser?: (func: string) => types.Program;
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
): types.Expression {
  const recur = (childAst: JexlAst) =>
    estreeFromJexlAst(grammar, childAst, options, [...ancestors, ast]);

  const createExpressionFromFunction = (
    func: Function | undefined,
    args: types.Expression[]
  ) => {
    if (!func) {
      return undefined;
    }

    let functionBodyAst:
      | types.Statement
      | types.ModuleDeclaration
      | types.Expression
      | undefined = options.functionParser?.(func.toString()).body?.[0];

    if (functionBodyAst) {
      // If the function body is an expression statement, unwrap it
      if (is.expressionStatement(functionBodyAst)) {
        functionBodyAst = functionBodyAst.expression;
      }

      if (
        is.arrowFunctionExpression(functionBodyAst) ||
        is.functionDeclaration(functionBodyAst)
      ) {
        const functionParams = functionBodyAst.params;
        const functionBody = functionBodyAst.body;

        // Wrap the function body in a `Program` so we can track variable scope when traversing below
        const functionBodyAsProgram = b.program([
          is.blockStatement(functionBody)
            ? functionBody
            : b.expressionStatement(functionBody),
        ]);

        // Replace occurrences of the parameter in the function body with the corresponding argument.
        // This mutates `functionBody` which is wrapped by `functionBodyAsProgram`.
        traverse(functionBodyAsProgram, {
          $: {
            scope: true,
            validateNodes: false, // Prevents error: "null" is not a valid identifier
          },
          Identifier(path) {
            // Check if the path is a reference
            if (!utils.isReference(path)) {
              return;
            }

            const functionParamIndex = functionParams.findIndex(
              (param) => is.identifier(param) && param.name === path.node?.name
            );
            if (functionParamIndex >= 0) {
              path.replaceWith(
                args[functionParamIndex] ?? b.identifier("undefined")
              );
            }
          },
        });

        // Remove superfluous `undefined` arguments from function calls
        traverse(functionBody, {
          CallExpression(path) {
            if (!path.node) {
              return;
            }

            for (let i = path.node.arguments.length - 1; i >= 0; i--) {
              const argumentNode = path.node.arguments[i];
              if (
                is.identifier(argumentNode) &&
                argumentNode.name === "undefined"
              ) {
                path.node.arguments.splice(i, 1);
              } else {
                break;
              }
            }
          },
        });

        if (is.blockStatement(functionBody)) {
          // If the function is just a return statement, unwrap it
          if (functionBody.body.length === 1) {
            const expression = functionBody.body[0];
            if (is.returnStatement(expression)) {
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
        case "in":
          return b.callExpression(
            b.memberExpression(
              recur(ast.right),
              b.identifier("includes"),
              false
            ),
            [recur(ast.left)]
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
          b.property("init", b.identifier(key), recur(value), false, false)
        )
      );
    case "FilterExpression":
      if (ast.relative) {
        // Extract all properties used to index into the object
        return b.callExpression(
          b.memberExpression(recur(ast.subject), b.identifier("filter")),
          [
            b.arrowFunctionExpression(
              findAllRelativeIdentifiers(ast.expr).map((name) =>
                b.objectPattern([
                  b.property(
                    "init",
                    b.identifier(name),
                    b.identifier(name),
                    false, // computed
                    true // shorthand
                  ) as types.ObjectPattern["properties"][number], // estree-toolkit types don't seem to accept "property" as a child of "objectPattern" even though it is valid
                ])
              ),
              recur(ast.expr)
            ),
          ]
        );
      } else {
        // We are just indexing into an object/array
        return b.memberExpression(recur(ast.subject), recur(ast.expr), true);
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

function findAllRelativeIdentifiers(
  ast: JexlAst,
  foundIdentifiers: string[] = []
): string[] {
  switch (ast.type) {
    case "Literal":
      break;
    case "Identifier":
      if (ast.relative) {
        foundIdentifiers.push(ast.value);
      }
      break;
    case "ArrayLiteral":
      for (const value of ast.value) {
        findAllRelativeIdentifiers(value, foundIdentifiers);
      }
      break;
    case "ObjectLiteral":
      for (const value of Object.values(ast.value)) {
        findAllRelativeIdentifiers(value, foundIdentifiers);
      }
      break;
    case "FilterExpression":
      findAllRelativeIdentifiers(ast.subject, foundIdentifiers);
      findAllRelativeIdentifiers(ast.expr, foundIdentifiers);
      break;
    case "UnaryExpression":
      findAllRelativeIdentifiers(ast.right, foundIdentifiers);
      break;
    case "BinaryExpression":
      findAllRelativeIdentifiers(ast.left, foundIdentifiers);
      findAllRelativeIdentifiers(ast.right, foundIdentifiers);
      break;
    case "ConditionalExpression":
      findAllRelativeIdentifiers(ast.test, foundIdentifiers);
      findAllRelativeIdentifiers(ast.consequent, foundIdentifiers);
      findAllRelativeIdentifiers(ast.alternate, foundIdentifiers);
      break;
    case "FunctionCall":
      for (const arg of ast.args) {
        findAllRelativeIdentifiers(arg, foundIdentifiers);
      }
      break;
  }
  return foundIdentifiers;
}
