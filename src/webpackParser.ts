import FileParser from "./fileParser";

import traverse, { NodePath } from "@babel/traverse";
import fs from "fs-extra";
import * as bblp from "@babel/parser";
import generator from "@babel/generator";
import {
  isFunctionExpression,
  File,
  ArrayExpression,
  isIdentifier,
  isNumericLiteral,
  FunctionExpression,
  isExpressionStatement,
  isCallExpression,
  isMemberExpression,
  isStringLiteral,
  AssignmentExpression,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  exportDefaultDeclaration,
  exportNamedDeclaration,
  isObjectExpression,
  variableDeclaration,
  variableDeclarator,
  functionDeclaration,
  isClassExpression,
  isVariableDeclaration,
  isLogicalExpression,
} from "@babel/types";

export type Module = any;

export default class WebpackParser implements FileParser {
  private isWebpackFile = (file: string) =>
    file.includes("Chunks") || file.includes("window.webpackJsonp");

  async isParseable(filename: any): Promise<boolean> {
    try {
      const file = await fs.readFile(filename, "utf-8");

      return this.isWebpackFile(file);
    } catch (e) {
      return false;
    }
  }

  async parse(filename: any): Promise<any[]> {
    const file = await fs.readFile(filename, "utf-8");
    const ast = bblp.parse(file);

    const modules: Module[] = [];

    this.parseAst(ast, modules);

    return modules;
  }

  protected parseAst(ast: File, modules: Module[]): void {
    // let argument;

    traverse(ast, {
      /* ExpressionStatement(path) {
        const { expression }: any = path.node;
        // console.log(expression);
        console.log(
          expression.type,
          expression.callee?.type,
          expression.callee?.operator,
          expression.callee?.argument?.type,
          expression.arguments?.length
        );
        if (
          expression.type === "CallExpression" &&
          expression.callee.type === "UnaryExpression" &&
          expression.callee.operator === "!" &&
          expression.callee.argument.type === "FunctionExpression" &&
          expression.arguments.length === 1 &&
          expression.arguments[0].type === "ArrayExpression"
        ) {
          argument = expression.arguments[0];
          console.log(false && argument);
        }
      }, */
      CallExpression: (nodePath) => {
        const firstArg = nodePath.get("arguments")[0];
        // console.log(firstArg);

        if (
          isFunctionExpression(nodePath.node.callee) &&
          firstArg?.isArrayExpression()
        ) {
          // entrypoint
          console.log("firstArg !!");

          //   console.log(generator(firstArg.node).code);

          this.parseArray(ast, firstArg, modules);
        }
      },
    });
  }

  private parseArray(
    file: File,
    ast: NodePath<ArrayExpression>,
    modules: Module[]
  ): void {
    ast.get("elements").forEach((element, i) => {
      if (!element.isFunctionExpression()) return;
      if (element.node.body.body.length === 0) return;

      const depIndex: number[] = [];
      const requireIdentifer = element.node.params[2];
      if (isIdentifier(requireIdentifer)) {
        element.traverse({
          VariableDeclarator: (path) => {
            if (
              isVariableDeclaration(path.parent) &&
              isIdentifier(path.node.id) &&
              path.parent.kind === "const" // imports are const
            ) {
              let containsRequire = false;

              path.traverse({
                CallExpression(cEPath) {
                  if (
                    isIdentifier(cEPath.node.callee) &&
                    isNumericLiteral(cEPath.node.arguments[0]) &&
                    cEPath.scope.bindingIdentifierEquals(
                      cEPath.node.callee.name,
                      requireIdentifer
                    )
                  ) {
                    containsRequire = true;
                    // console.log(cEPath.node);
                    cEPath.stop(); // Stop traversing further, as we found the require call
                  }
                },
              });

              if (containsRequire) {
                const name = path.node.id.name;
                const binding = path.scope.getBinding(name);
                if (binding) {
                  const newName = `import_${name}`;
                  binding.identifier.name = newName;
                  // Rename all references to the binding
                  binding.referencePaths.forEach((referencePath) => {
                    if (
                      isIdentifier(referencePath.node) &&
                      referencePath.node.name === name
                    ) {
                      referencePath.node.name = newName;
                    }
                  });
                }
              }
              //   console.log(containsRequire, path.node.id.name);
            }
          },
          CallExpression: (depPath) => {
            if (
              !isIdentifier(depPath.node.callee) ||
              !isNumericLiteral(depPath.node.arguments[0])
            )
              return;
            if (
              depPath.scope.bindingIdentifierEquals(
                depPath.node.callee.name,
                requireIdentifer
              )
            ) {
              depIndex.push(depPath.node.arguments[0].value);
              //   depIndex[depPath.node.arguments[0].value] =
              // depPath.node.arguments[0].value;
            }
          },
        });
      }

      let mod = {
        file: file,
        element: element,
        i: i,
        deps: depIndex,
      };
      console.log("require: ", depIndex);

      this.cleanES6Object(element);
      this.cleanES6Import(element);
      this.cleanImports(element);

      console.log(generator(element.node).code);

      modules[i] = mod;
    });
  }

  /**
   * Remove the "__importDefault" stuff
   * @param path
   */
  private cleanES6Import(path: NodePath<FunctionExpression>): void {
    const bodyPath = path.get("body");

    bodyPath.node.body = bodyPath.node.body.filter((line) => {
      let declaration = null;
      if (
        isVariableDeclaration(line) &&
        line.kind === "var" && // Somehow the useless __importDefault is always var
        line.declarations.length === 1 &&
        isLogicalExpression((declaration = line.declarations[0]).init) &&
        declaration.init.operator === "||" &&
        isFunctionExpression(declaration.init.right) &&
        declaration.init.right.params.length === 1 &&
        isLogicalExpression(declaration.init.left) &&
        isMemberExpression(declaration.init.left.right) &&
        isIdentifier(declaration.init.left.right.property) &&
        declaration.init.left.right.property.name === "__importDefault"
      ) {
        return false; // Skip the line containing `this.__importDefault`
      }
      return true;
    });
  }

  /**
   * Remove the "Object.defineProperty(e, "__esModule", ...)" stuff
   * @param path
   */
  private cleanES6Object(path: NodePath<FunctionExpression>): void {
    const bodyPath = path.get("body");

    var isEsModule = false;

    bodyPath.node.body = bodyPath.node.body.filter((line) => {
      const callExp = isExpressionStatement(line) ? line.expression : line;
      if (!isCallExpression(callExp)) return true;
      if (!isMemberExpression(callExp.callee)) return true;
      if (
        !isIdentifier(callExp.callee.object) ||
        !isIdentifier(callExp.callee.property)
      )
        return true;
      if (
        callExp.callee.object.name !== "Object" ||
        callExp.callee.property.name !== "defineProperty"
      )
        return true;
      if (
        !isIdentifier(callExp.arguments[0]) ||
        !isStringLiteral(callExp.arguments[1])
      )
        return true;
      //   if (
      //     bodyPath.scope.getBindingIdentifier(callExp.arguments[0].name)
      //       ?.start !== "e" // module.exportsParam?.start
      //   )
      //     return true;
      if (callExp.arguments[1].value !== "__esModule") return true;

      isEsModule = true;
      return false;
    });

    if (isEsModule) {
      let comment = "__esModule";
      bodyPath.addComment("leading", `${comment}`, true);
    }
  }

  private cleanImports(path: NodePath<FunctionExpression>): void {
    const bodyPath = path.get("body");

    const exportName = isIdentifier(path.node.params[1])
      ? path.node.params[1].name
      : "e";

    bodyPath.traverse({
      AssignmentExpression: (path) => {
        const { left } = path.node;

        // console.log(left);
        if (
          !isMemberExpression(left) ||
          !isIdentifier(left.object) ||
          !isIdentifier(left.property) ||
          left.object.name !== exportName
        )
          return;

        const isDefault = left.property.name === "default";
        const generatedExport = this.generateES6Export(path.node, isDefault);
        console.debug(">> generatedExport ", generatedExport === null);
        if (!generatedExport) return;

        if (isExpressionStatement(path.parent)) {
          console.debug("replaceWith generatedES6Export");
          path.parentPath.replaceWith(generatedExport);
          // } else if (isFunctionExpression(path.node.right) && path.parentPath.isVariableDeclarator() && isIdentifier(path.parentPath.node.id)) {
          //     path.scope.rename(
          //       path.parentPath.node.id.name,
          //       path.node.left.property.name
          //     );
        }

        // console.log(path);
      },
    });
  }

  private generateES6Export(
    node: AssignmentExpression,
    isDefault: boolean
  ): ExportNamedDeclaration | ExportDefaultDeclaration | null {
    if (!isMemberExpression(node.left) || !isIdentifier(node.left.property))
      return null;

    // console.log(generator(node).code);

    const exportType = isDefault
      ? exportDefaultDeclaration
      : exportNamedDeclaration;

    // console.debug("exportType:", exportType.name);
    // console.debug("node.right:", node.right);

    if (isClassExpression(node.right) && isDefault) {
      return exportDefaultDeclaration(node.right);
    }

    if (isObjectExpression(node.right) && !isDefault) {
      return exportNamedDeclaration(
        variableDeclaration("const", [
          variableDeclarator(node.left.property, node.right),
        ])
      );
    }

    if (isFunctionExpression(node.right)) {
      return exportType(
        functionDeclaration(
          node.left.property,
          node.right.params,
          node.right.body
        )
      );
    }
    console.debug(
      "isIdentifier",
      isIdentifier(node.right),
      "isDefault",
      isDefault
    );
    if (isIdentifier(node.right) && isDefault) {
      return exportDefaultDeclaration(node.right);
    }
    return null;
  }

  //   private moduleToES6Import() {}
}

// parse(args)
