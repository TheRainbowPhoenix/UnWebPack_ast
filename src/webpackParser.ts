import FileParser from "./fileParser.ts";

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
  private fileUsedNames = new Map<string, Set<string>>();
  private fileLetterCounters = new Map<string, Map<string, number>>();
  private aliasById = new Map<string, string>();

  private readonly _alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

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

  setAliasMap(aliases: Record<string | number, string>) {
    this.aliasById.clear();
    for (const [k, v] of Object.entries(aliases)) {
      // Expect valid identifiers in v (e.g., React, ReactDOM, classnames, lodash)
      this.aliasById.set(String(k), v);
    }
  }

  async parse(filename: any): Promise<Module[]> {
    const file = await fs.readFile(filename, "utf-8");
    this.currentFile = filename;

    // reset per-file state
    this.fileUsedNames.set(filename, new Set<string>());
    this.fileLetterCounters.set(filename, new Map<string, number>());

    const ast: bblp.ParseResult<File> = bblp.parse(file);
    const modules: Module[] = [];

    this.parseAst(ast, modules);

    return modules;
  }

  private _usedSet(): Set<string> {
    const set = this.fileUsedNames.get(this.currentFile!);
    if (!set) throw new Error("used-name set not init");
    return set;
  }
  
  private _counters(): Map<string, number> {
    const map = this.fileLetterCounters.get(this.currentFile!);
    if (!map) throw new Error("letter counters not init");
    return map;
  }

  private _toBase52(n: number, minLen = 3): string {
    // 0 -> 'a', 51 -> 'Z', 52 -> 'ba'
    if (n === 0) {
      return "a".repeat(minLen);
    }
    const digits: string[] = [];
    while (n > 0) {
      const r = n % 52;
      digits.push(this._alpha[r]);
      n = Math.floor(n / 52);
    }
    let s = digits.reverse().join("");
    // left-pad with 'a' to minLen
    while (s.length < minLen) s = "a" + s;
    return s;
  }

  private _nextNameFor(letter: string, scope: import("@babel/traverse").Scope): string {
    const used = this._usedSet();
    const counters = this._counters();
    let idx = counters.get(letter) ?? 0;

    while (true) {
      const candidate = `${letter}_${this._toBase52(idx, 3)}`;
      // ensure uniqueness across file + local scope
      if (!used.has(candidate) && !scope.hasBinding(candidate)) {
        used.add(candidate);
        counters.set(letter, idx + 1);
        return candidate;
      }
      idx++;
    }
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

  private demangleVoid0(fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>) {
    const isVoid0 = (n: t.Node) => t.isUnaryExpression(n, { operator: "void" }) && t.isNumericLiteral(n.argument, { value: 0 });

    fnPath.traverse({
      UnaryExpression: (p) => {
        if (isVoid0(p.node)) p.replaceWith(t.identifier("undefined"));
      },
      BinaryExpression: (p) => {
        const { node } = p;
        if ((node.operator === "===" || node.operator === "==" || node.operator === "!==" || node.operator === "!=") &&
            (isVoid0(node.left) || isVoid0(node.right))) {
          if (isVoid0(node.left)) node.left = t.identifier("undefined");
          if (isVoid0(node.right)) node.right = t.identifier("undefined");
          p.replaceWith(node);
        }
      },
    });
  }

  private normalizeYoda(fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>) {
    fnPath.traverse({
      BinaryExpression: (bp) => {
        const { node } = bp;
        if (!["===", "==", "!==", "!="].includes(node.operator)) return;
        const leftConst =
          t.isLiteral(node.left as any) || t.isIdentifier(node.left, { name: "undefined" });
        const rightVar =
          t.isIdentifier(node.right) || t.isMemberExpression(node.right);
        if (leftConst && rightVar) {
          bp.replaceWith(t.binaryExpression(node.operator, node.right as any, node.left as any));
        }
      },
    });
  }

  private renameBindingIn(fnPath: NodePath<any>, oldName: string, desired: string): string {
    const scope = fnPath.scope;
    let finalName = desired;
    if (desired !== oldName && scope.hasBinding(desired)) {
      finalName = scope.generateUidIdentifier(desired).name;
    }
    scope.rename(oldName, finalName);
    return finalName;
  }

  private applyRequireAliases(
    fnPath: import("@babel/traverse").NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
    interopName: string | null // pass the name you detected earlier, e.g. "interopRequireDefault"
  ) {
    const getRequireId = (node: t.Node): string | null => {
      // __webpack_require__(ID)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: "__webpack_require__" })) {
        const a0 = node.arguments[0];
        if (t.isNumericLiteral(a0) || t.isStringLiteral(a0)) return String(a0.value);
        return null;
      }
      // __webpack_require__.n(__webpack_require__(ID))
      if (
        t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: "__webpack_require__" }) &&
        t.isIdentifier(node.callee.property, { name: "n" }) &&
        node.arguments.length === 1
      ) {
        return getRequireId(node.arguments[0] as t.Node);
      }
      return null;
    };

    fnPath.get("body").traverse(
      {
        VariableDeclarator: (p) => {
          const id = p.node.id;
          if (!t.isIdentifier(id)) return;
          const init = p.node.init;
          if (!init) return;

          // unwrap interop wrapper if present: interopRequireDefault(__webpack_require__(ID))
          let call = init as t.Expression;
          if (
            interopName &&
            t.isCallExpression(call) &&
            t.isIdentifier(call.callee, { name: interopName }) &&
            call.arguments.length >= 1
          ) {
            call = call.arguments[0] as t.Expression;
          }

          const reqId = getRequireId(call);
          if (!reqId) return;

          const alias = this.aliasById.get(reqId);
          if (!alias) return; // not mapped

          this.renameBindingIn(fnPath, id.name, alias);

          // OPTIONAL: If you'd like to keep this alias from being later “single-letter” renamed,
          // add it to your protected set here (if you implemented one).
          // this.protectName(alias);
        },
      },
      fnPath
    );
  }

  // is: function(x){ return x && x.__esModule ? x : { default: x } }
  private isInteropRequireDefaultFn(fn: t.Function): boolean {
    if (fn.params.length !== 1 || !t.isIdentifier(fn.params[0])) return false;
    const p = (fn.params[0] as t.Identifier).name;

    // get the single return expression (handles arrow expr body or block body)
    let ret: t.Expression | null = null;
    const body: any = (fn as any).body; // ArrowFunctionExpression can have Expression body
    if (t.isBlockStatement(body)) {
      const r = body.body.find(s => t.isReturnStatement(s)) as t.ReturnStatement | undefined;
      ret = r?.argument ?? null;
    } else {
      ret = body as t.Expression;
    }
    if (!ret || !t.isConditionalExpression(ret)) return false;

    const test = ret.test;
    const cons = ret.consequent;
    const alt  = ret.alternate;

    const testOk =
      t.isLogicalExpression(test, { operator: "&&" }) &&
      t.isIdentifier(test.left, { name: p }) &&
      t.isMemberExpression(test.right) &&
      t.isIdentifier(test.right.object, { name: p }) &&
      t.isIdentifier(test.right.property, { name: "__esModule" });

    const consOk = t.isIdentifier(cons, { name: p });
    const altOk =
      t.isObjectExpression(alt) &&
      alt.properties.length === 1 &&
      t.isObjectProperty(alt.properties[0]) &&
      !alt.properties[0].computed &&
      t.isIdentifier(alt.properties[0].key, { name: "default" }) &&
      t.isIdentifier(alt.properties[0].value, { name: p });

    return testOk && consOk && altOk;
  }

  // Rename the interop helper (d -> interopRequireDefault), return its final name
  private renameInteropHelper(
    fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>
  ): string | null {
    let interopName: string | null = null;

    // Only look at bindings defined in this module function's top scope
    fnPath.get("body").traverse({
      FunctionDeclaration: (p) => {
        const id = p.node.id;
        if (!id) return;
        if (this.isInteropRequireDefaultFn(p.node)) {
          interopName = this.renameBindingIn(fnPath, id.name, "interopRequireDefault");
        }
      },
      VariableDeclarator: (p) => {
        if (!t.isIdentifier(p.node.id)) return;
        const init = p.node.init;
        if (!init || (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init))) return;
        if (this.isInteropRequireDefaultFn(init)) {
          interopName = this.renameBindingIn(fnPath, p.node.id.name, "interopRequireDefault");
        }
      },
    }, fnPath);

    return interopName;
  }

  // Rename single-letter require/import bindings: r -> import_r, s -> require_s
  private renameRequireBindings(
    fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>,
    interopName: string | null
  ) {
    fnPath.get("body").traverse({
      VariableDeclarator: (p) => {
        const id = p.node.id;
        if (!t.isIdentifier(id)) return;

        // only single-letter names (you can relax this if you like)
        if (id.name.length !== 1) return;

        const init = p.node.init;
        if (!init || !t.isCallExpression(init)) return;

        // wrapped: interopRequireDefault(__webpack_require__(N))
        const isWrappedRequire =
          interopName != null &&
          t.isIdentifier(init.callee, { name: interopName }) &&
          init.arguments.length >= 1 &&
          t.isCallExpression(init.arguments[0]) &&
          t.isIdentifier((init.arguments[0] as t.CallExpression).callee, { name: "__webpack_require__" });

        // direct: __webpack_require__(N) or __webpack_require__.n(...)
        const isDirectRequire =
          t.isIdentifier(init.callee, { name: "__webpack_require__" }) ||
          (t.isMemberExpression(init.callee) &&
          t.isIdentifier(init.callee.object, { name: "__webpack_require__" }));

        if (isWrappedRequire) {
          this.renameBindingIn(fnPath, id.name, `import_${id.name}`);
        } else if (isDirectRequire) {
          this.renameBindingIn(fnPath, id.name, `require_${id.name}`);
        }
      },
    }, fnPath);
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

  private renameSingleLetterBindings(fnPath: NodePath<FunctionExpression | ArrowFunctionExpression>) {
    const isSingleLetter = (name: string) => /^[A-Za-z]$/.test(name);

    // VariableDeclarator: var/let/const x = ...
    fnPath.traverse({
      VariableDeclarator: (p) => {
        if (!t.isIdentifier(p.node.id)) return;
        const name = p.node.id.name;
        if (!isSingleLetter(name)) return;

        const binding = p.scope.getBinding(name);
        if (!binding) return;

        const newName = this._nextNameFor(name, binding.scope);
        if (newName !== name) {
          binding.scope.rename(name, newName);
        }
      },

      // Any function params (FunctionDeclaration/Expression/Arrow)
      Function: (p) => {
        // Optionally rename the function's own *name* if it's a single letter.
        // (comment this block out if you don't want function names changed)
        if (t.isFunctionDeclaration(p.node) || t.isFunctionExpression(p.node)) {
          const id = p.node.id;
          if (id && isSingleLetter(id.name)) {
            const b = p.scope.getBinding(id.name);
            if (b) {
              const newName = this._nextNameFor(id.name, b.scope);
              if (newName !== id.name) b.scope.rename(id.name, newName);
            }
          }
        }

        // Rename parameters that are simple Identifiers
        for (const param of p.node.params) {
          if (!t.isIdentifier(param)) continue;
          const pname = param.name;
          if (!isSingleLetter(pname)) continue;

          const b = p.scope.getBinding(pname);
          if (!b) continue;

          const newName = this._nextNameFor(pname, b.scope);
          if (newName !== pname) b.scope.rename(pname, newName);
        }
      },

      // catch (e) { … }
      CatchClause: (p) => {
        const param = p.node.param;
        if (param && t.isIdentifier(param) && isSingleLetter(param.name)) {
          const b = p.scope.getBinding(param.name);
          if (!b) return;
          const newName = this._nextNameFor(param.name, b.scope);
          if (newName !== param.name) b.scope.rename(param.name, newName);
        }
      },
    });
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
          this.demangleVoid0(valPath);
          // this.demangleNegatedIIFE(valPath);
          // this.expandSequences(valPath);
          this.normalizeYoda(valPath);

          const interopName = this.renameInteropHelper(valPath);
          this.renameRequireBindings(valPath, interopName); // import_r / require_s (from earlier)
          this.applyRequireAliases(valPath, interopName); // import_r -> React, etc.

          this.renameSingleLetterBindings(valPath);


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
