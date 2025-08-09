// webpack-deps-babel.js - Babel-based dependency extractor

import FileParser from "./fileParser";
import traverse from "@babel/traverse";
import fs from "fs-extra";
import * as bblp from "@babel/parser";
import {
  isFunctionExpression,
  File,
  isIdentifier,
  isNumericLiteral,
  isCallExpression,
} from "@babel/types";

export default class WebpackDepsParser {
  async isParseable(filename) {
    try {
      const file = await fs.readFile(filename, "utf-8");
      return file.includes("webpackJsonp") || file.includes("push");
    } catch (e) {
      return false;
    }
  }

  async parse(filename) {
    const file = await fs.readFile(filename, "utf-8");
    const ast = bblp.parse(file, {
      sourceType: "script",
      plugins: ["dynamicImport"]
    });

    const dependencies = {};
    const moduleInfo = {};

    traverse(ast, {
      CallExpression: (path) => {
        // Look for webpackJsonp.push() calls
        if (
          isCallExpression(path.node.callee) &&
          path.node.callee.callee?.property?.name === "push"
        ) {
          const args = path.node.arguments;
          if (args.length > 0) {
            this.parseWebpackPushCall(args[0], dependencies, moduleInfo);
          }
        }
      }
    });

    return { dependencies, moduleInfo };
  }

  parseWebpackPushCall(argument, dependencies, moduleInfo) {
    if (!argument.elements || argument.elements.length < 2) return;

    const modulesArray = argument.elements[1];
    if (!modulesArray) return;

    // Handle both array and object formats
    if (modulesArray.properties) {
      // Object format: { 1026: function(...) {...}, 1027: function(...) {...} }
      modulesArray.properties.forEach(prop => {
        if (prop.key && prop.value && isFunctionExpression(prop.value)) {
          const moduleId = prop.key.value;
          const deps = this.extractDependencies(prop.value);
          dependencies[moduleId] = deps;
          moduleInfo[moduleId] = {
            type: 'object',
            loc: prop.loc
          };
        }
      });
    } else if (modulesArray.elements) {
      // Array format: [function(...), function(...), ...]
      modulesArray.elements.forEach((element, index) => {
        if (element && isFunctionExpression(element)) {
          const deps = this.extractDependencies(element);
          dependencies[index] = deps;
          moduleInfo[index] = {
            type: 'array',
            loc: element.loc
          };
        }
      });
    }
  }

  extractDependencies(functionNode) {
    const deps = new Set();
    const requireIdentifier = functionNode.params[2]; // third parameter is require
    
    if (!isIdentifier(requireIdentifier)) return [];

    traverse(functionNode, {
      CallExpression: (path) => {
        // Look for calls to the require function: n(123)
        if (
          isIdentifier(path.node.callee) &&
          path.node.callee.name === requireIdentifier.name &&
          path.node.arguments.length > 0 &&
          isNumericLiteral(path.node.arguments[0])
        ) {
          deps.add(path.node.arguments[0].value);
        }
      }
    }, functionNode.scope); // Limit traversal to function scope

    return Array.from(deps).sort((a, b) => a - b);
  }
}

// Usage script
import fsExtra from "fs-extra";

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error("Usage: node webpack-deps-babel.js <input-file>");
    process.exit(1);
  }

  try {
    console.log("🔍 Parsing with Babel...");
    const parser = new WebpackDepsParser();
    
    if (!(await parser.isParseable(inputFile))) {
      console.log("❌ File doesn't appear to be a webpack file");
      return;
    }

    const { dependencies, moduleInfo } = await parser.parse(inputFile);
    
    console.log(`✅ Found ${Object.keys(dependencies).length} modules with dependencies`);
    
    // Show some statistics
    const chunksWithDeps = Object.entries(dependencies).filter(([_, deps]) => deps.length > 0);
    console.log(`📊 Modules with dependencies: ${chunksWithDeps.length}`);
    
    // Show top modules by import count
    const sortedByImports = Object.entries(dependencies)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);
    
    console.log("📈 Top modules by import count:");
    sortedByImports.forEach(([id, deps]) => {
      if (deps.length > 0) {
        console.log(`  Module ${id}: ${deps.length} imports [${deps.join(', ')}]`);
      }
    });
    
    // Build reverse map for most imported
    const reverseMap = {};
    for (const [chunk, imports] of Object.entries(dependencies)) {
      for (const imp of imports) {
        if (!reverseMap[imp]) reverseMap[imp] = [];
        reverseMap[imp].push(parseInt(chunk));
      }
    }
    
    // Find most imported
    const mostImported = Object.entries(reverseMap)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);
    
    console.log("🏆 Most imported modules:");
    mostImported.forEach(([id, importers]) => {
      console.log(`  Module ${id}: imported by ${importers.length} modules`);
    });
    
    // Save results
    await fsExtra.writeJson("babel-dependencies.json", dependencies, { spaces: 2 });
    await fsExtra.writeJson("babel-module-info.json", moduleInfo, { spaces: 2 });
    
    console.log("✅ Results saved to babel-dependencies.json and babel-module-info.json");

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("Stack:", err.stack);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default WebpackDepsParser;