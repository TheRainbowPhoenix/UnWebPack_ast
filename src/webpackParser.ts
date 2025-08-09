import FileParser from "./fileParser";

import traverse, { NodePath } from "@babel/traverse";
import fs from "fs-extra";
import * as bblp from "@babel/parser";
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
  isAssignmentExpression,
  ArrowFunctionExpression,
  isArrayExpression,
  isObjectProperty,
  Identifier,
} from "@babel/types";
import * as t from "@babel/types";

import type Module from "./module";

export default class WebpackParser implements FileParser {
  private currentFile?: string;

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

  async parse(filename: any): Promise<Module[]> {
    const file = await fs.readFile(filename, "utf-8");
    this.currentFile = filename;
    const ast: bblp.ParseResult<File> = bblp.parse(file);

    const modules: Module[] = [];

    this.parseAst(ast, modules);

    return modules;
  }

  private demangleMinifiedBooleans(
    fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>
  ) {
    // Traverse only inside this wrapper function
    fnPath.traverse({
      UnaryExpression: (ux) => {
        if (ux.node.operator !== "!") return;
        const arg = ux.node.argument;
        if (t.isNumericLiteral(arg)) {
          if (arg.value === 0) {
            ux.replaceWith(t.booleanLiteral(true));
          } else if (arg.value === 1) {
            ux.replaceWith(t.booleanLiteral(false));
          }
        }
      },
    });
  }

  private normalizeModuleParamNames(
    fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>
  ) {
    const desired = ["module", "exports", "__webpack_require__"];

    // Only work with identifiers, skip patterns like {…} or defaults
    const params = fnPath.node.params.filter(
      (p): p is Identifier => p && p.type === "Identifier"
    );

    for (let i = 0; i < Math.min(params.length, desired.length); i++) {
      const id = params[i];
      const from = id.name;
      const to = desired[i];
      if (from === to) continue;

      // If something else already binds `to` in THIS function, free it first
      const existing = fnPath.scope.getBinding(to);
      if (existing && existing.identifier !== id) {
        const fresh = fnPath.scope.generateUidIdentifier(to).name; // e.g. _module, _exports
        existing.scope.rename(to, fresh);
      }

      // Rename the parameter binding (updates the param node + all refs)
      fnPath.scope.rename(from, to);
    }
  }

  protected parseAst(ast: bblp.ParseResult<File>, modules: Module[]): void {
    // let argument;

    traverse(ast, {
      CallExpression: (path) => {
        const callee = path.node.callee;

        // We only care about `(...).push(...)`
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.property, { name: "push" })) return;

        // Make sure the object being pushed to looks like a webpack chunk array
        if (!this.isWebpackChunkArrayTarget(callee.object)) return;

        // The first (and only) argument should be an ArrayExpression:
        /// push([ [chunkIds...], { modules... }, runtime? ])
        const arg0 = path.get("arguments.0");
        if (!arg0 || !arg0.isArrayExpression()) return;

        const elements = arg0.get("elements");
        if (elements.length < 2) return;

        const chunkIdsNode = elements[0];
        const modulesNode = elements[1];

        if (!chunkIdsNode?.isArrayExpression()) return;
        if (!modulesNode?.isObjectExpression()) return;

        // Extract chunk IDs (numbers or strings)
        const chunkIds: Array<number | string> = chunkIdsNode
          .get("elements")
          .map((el) => {
            if (el?.isNumericLiteral()) return el.node.value;
            if (el?.isStringLiteral()) return el.node.value;
            return undefined;
          })
          .filter((v): v is number | string => v !== undefined);

        // Iterate : { <id>: function(...) { ... }, ... }
        for (const propPath of modulesNode.get("properties")) {
          if (!propPath.isObjectProperty()) continue;

          // Read the module id key
          const key = propPath.node.key;
          let moduleId: number | string | undefined;
          if (t.isIdentifier(key)) moduleId = key.name;
          else if (t.isNumericLiteral(key)) moduleId = key.value;
          else if (t.isStringLiteral(key)) moduleId = key.value;

          if (moduleId === undefined) continue;

          // Value should be a function (FunctionExpression or ArrowFunctionExpression)
          const valPath = propPath.get("value") as NodePath<
            FunctionExpression | ArrowFunctionExpression
          >;
          const isFn =
            valPath.isFunctionExpression() ||
            valPath.isArrowFunctionExpression();
          if (!isFn) continue;

          // normalize names
          this.normalizeModuleParamNames(
            valPath as NodePath<FunctionExpression | ArrowFunctionExpression>
          );
          this.demangleMinifiedBooleans(valPath as NodePath<FunctionExpression | ArrowFunctionExpression>);

          // push one record per chunk id
          for (const chunkId of chunkIds) {
            modules.push({
              file: this.currentFile,
              element: valPath,
              i: moduleId,
              deps: [],

              chunkId,
              moduleId,
              fn: valPath.node as
                | t.FunctionExpression
                | t.ArrowFunctionExpression,
            } as unknown as Module);
          }
        }
      },
    });
  }

  /**
   * Matches the target of `(...).push` for both:
   *   (window.webpackJsonp = window.webpackJsonp || []).push(...)
   *   (self.webpackChunkMyApp = self.webpackChunkMyApp || []).push(...)
   *   window.webpackJsonp.push(...)   // rare but seen
   *   self.webpackChunkX.push(...)
   */
  private isWebpackChunkArrayTarget(expr: t.Expression): boolean {
    const isWebpackArrayMember = (m: t.MemberExpression) => {
      const prop = t.isIdentifier(m.property)
        ? m.property.name
        : t.isStringLiteral(m.property)
        ? m.property.value
        : null;
      return (
        !!prop && (prop === "webpackJsonp" || prop.startsWith("webpackChunk"))
      );
    };

    // Direct member, e.g. window.webpackJsonp.push(...)
    if (t.isMemberExpression(expr) && isWebpackArrayMember(expr)) return true;

    // Assignment case: (window.webpackJsonp = window.webpackJsonp || []).push(...)
    if (t.isAssignmentExpression(expr)) {
      const { left, right } = expr;
      const leftOk = t.isMemberExpression(left) && isWebpackArrayMember(left);
      const rightOk =
        t.isLogicalExpression(right) &&
        right.operator === "||" &&
        t.isArrayExpression(right.right);
      return leftOk && rightOk;
    }

    return false;
  }

  // @ts-ignore
  private parseArray(
    file: bblp.ParseResult<File>,
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
      //   console.log("require: ", depIndex);

      this.cleanES6Object(element);
      this.cleanES6Import(element);
      this.cleanImports(element);

      //   console.log(generator(element.node).code);

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
        // console.debug(">> generatedExport ", generatedExport === null);
        if (!generatedExport) return;

        if (isExpressionStatement(path.parent)) {
          //   console.debug("replaceWith generatedES6Export");
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
    if (isIdentifier(node.right) && isDefault) {
      return exportDefaultDeclaration(node.right);
    }
    return null;
  }
}
