// astService.js

import * as acorn from "acorn";
import * as walk from "acorn-walk";

export function analyzeCode(code) {

  const result = {
    syntaxValid: true,

    functions: [],
    arrowFunctions: [],
    variables: [],

    loops: 0,
    conditionals: 0
  };

  try {

    const ast = acorn.parse(code, {
      ecmaVersion: "latest"
    });

    walk.simple(ast, {

      FunctionDeclaration(node) {

        if (node.id?.name) {

          result.functions.push(
            node.id.name
          );
        }
      },

      VariableDeclarator(node) {

        if (node.id?.name) {

          result.variables.push(
            node.id.name
          );
        }

        if (
          node.init?.type ===
          "ArrowFunctionExpression"
        ) {

          result.arrowFunctions.push(
            node.id.name
          );
        }
      },

      ForStatement() {
        result.loops++;
      },

      WhileStatement() {
        result.loops++;
      },

      IfStatement() {
        result.conditionals++;
      }

    });

  } catch (err) {

    result.syntaxValid = false;
    result.error = err.message;
  }

  return result;
}