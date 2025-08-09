import FileParser from "./fileParser.ts";

import _traverse from "npm:@babel/traverse";
const traverse = _traverse.default;

import * as bblp from "npm:@babel/parser";
import * as t from "npm:@babel/types";

const {
  isFunctionExpression,
  isIdentifier,
  isNumericLiteral,
  isCallExpression,
} = t;

export class WebpackDepsParser implements FileParser {
  async isParseable(filename: string): Promise<boolean> {
    try {
      const file = await Deno.readTextFile(filename);
      return file.includes("webpackJsonp") || file.includes("push");
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async parse(filename: string): Promise<any[]> {
    const file = await Deno.readTextFile(filename);
    const ast = bblp.parse(file, {
      sourceType: "script",
      plugins: ["dynamicImport"],
    });

    const dependencies: Record<string, number[]> = {};
    const moduleInfo: Record<string, any> = {};

    traverse(ast, {
      CallExpression: (path) => {
        if (
          t.isCallExpression(path.node.callee) &&
          (path.node.callee.callee as any)?.property?.name === "push"
        ) {
          const args = path.node.arguments;
          if (args.length > 0) {
            this.parseWebpackPushCall(args[0] as t.ArrayExpression, dependencies, moduleInfo);
          }
        }
      },
    });

    return [{ dependencies, moduleInfo }];
  }

  private parseWebpackPushCall(argument: t.ArrayExpression, dependencies: Record<string, any>, moduleInfo: Record<string, any>) {
    if (!argument.elements || argument.elements.length < 2) return;

    const modulesArray = argument.elements[1];
    if (!modulesArray) return;

    if (t.isObjectExpression(modulesArray)) {
      modulesArray.properties.forEach((prop) => {
        if (t.isObjectProperty(prop) && prop.key && t.isFunctionExpression(prop.value)) {
          const moduleId = (prop.key as t.NumericLiteral).value;
          const deps = this.extractDependencies(prop.value);
          dependencies[moduleId] = deps;
          moduleInfo[moduleId] = { type: "object", loc: prop.loc };
        }
      });
    } else if (t.isArrayExpression(modulesArray)) {
      modulesArray.elements.forEach((element, index) => {
        if (element && t.isFunctionExpression(element)) {
          const deps = this.extractDependencies(element);
          dependencies[index] = deps;
          moduleInfo[index] = { type: "array", loc: element.loc };
        }
      });
    }
  }

  private extractDependencies(functionNode: t.FunctionExpression): number[] {
    const deps = new Set<number>();
    const requireIdentifier = functionNode.params[2];

    if (!isIdentifier(requireIdentifier)) return [];

    traverse(
      functionNode,
      {
        CallExpression: (path) => {
          if (
            isIdentifier(path.node.callee) &&
            path.node.callee.name === requireIdentifier.name &&
            path.node.arguments.length > 0 &&
            isNumericLiteral(path.node.arguments[0])
          ) {
            deps.add(path.node.arguments[0].value);
          }
        },
      },
      functionNode.scope
    );

    return Array.from(deps).sort((a, b) => a - b);
  }
}

async function main() {
  const inputFile = Deno.args[0];
  if (!inputFile) {
    console.error("Usage: deno run --allow-read --allow-write webpackDeps.ts <input-file>");
    Deno.exit(1);
  }

  try {
    console.log("🔍 Parsing with Babel...");
    const parser = new WebpackDepsParser();

    if (!(await parser.isParseable(inputFile))) {
      console.log("❌ File doesn't appear to be a webpack file");
      return;
    }

    const [{ dependencies, moduleInfo }] = await parser.parse(inputFile);

    console.log(`✅ Found ${Object.keys(dependencies).length} modules with dependencies`);

    const chunksWithDeps = Object.entries(dependencies).filter(
      ([, deps]) => deps.length > 0
    );
    console.log(`📊 Modules with dependencies: ${chunksWithDeps.length}`);

    const sortedByImports = Object.entries(dependencies)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    console.log("📈 Top modules by import count:");
    sortedByImports.forEach(([id, deps]) => {
      if (deps.length > 0) {
        console.log(`  Module ${id}: ${deps.length} imports [${deps.join(", ")}]`);
      }
    });

    const reverseMap: Record<string, number[]> = {};
    for (const [chunk, imports] of Object.entries(dependencies)) {
      for (const imp of imports) {
        if (!reverseMap[imp]) reverseMap[imp] = [];
        reverseMap[imp].push(parseInt(chunk));
      }
    }

    const mostImported = Object.entries(reverseMap)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    console.log("🏆 Most imported modules:");
    mostImported.forEach(([id, importers]) => {
      console.log(`  Module ${id}: imported by ${importers.length} modules`);
    });
    
    await Deno.writeTextFile("babel-dependencies.json", JSON.stringify(dependencies, null, 2));
    await Deno.writeTextFile("babel-module-info.json", JSON.stringify(moduleInfo, null, 2));

    console.log("✅ Results saved to babel-dependencies.json and babel-module-info.json");
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("Stack:", err.stack);
  }
}

// Run if this script is the main module
if (import.meta.main) {
  main();
}

export default WebpackDepsParser;