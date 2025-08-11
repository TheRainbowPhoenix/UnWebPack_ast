import { walk } from "jsr:@std/fs/walk";
import * as path from "jsr:@std/path";
import * as bblp from "npm:@babel/parser";
import _traverse, { type NodePath } from "npm:@babel/traverse";
import * as t from "npm:@babel/types";

// Babel's CJS/ESM interop can be tricky, so we handle the default export.
const traverse = (_traverse as any).default ?? _traverse;

/**
 * REGEX EXPLANATION:
 * ^import\s+               - Matches "import" at the start of a line, followed by space.
 * (?:                      - Starts an optional non-capturing group for the import names.
 *   (?:([\w$]+)\s*,?\s*)?   - An optional group to capture the DEFAULT import name (e.g., "baseTimes").
 *                            - ([\w$]+) is CAPTURE GROUP 1: the label.
 *   (?:\{[^}]*\}\s*,?\s*)?  - An optional group to match but NOT capture named imports (e.g., "{ isArray }").
 * )?                       - End of the optional group for import names.
 * from\s+                  - Matches "from" followed by space.
 * ['"](.*?)['"];?          - Matches the path inside quotes.
 *                            - (.*?) is CAPTURE GROUP 2: the relative path.
 *
 * This regex handles cases like:
 * - import baseTimes from './_baseTimes.js';        (Captures "baseTimes" and "./_baseTimes.js")
 * - import { isArray } from './isArray.js';           (Captures undefined and "./isArray.js")
 * - import isBuffer, { isArray } from './isBuffer.js'; (Captures "isBuffer" and "./isBuffer.js")
 */
const IMPORT_REGEX = /^import\s+(?:(?:([\w$]+)\s*,?\s*)?(?:\{[^}]*\}\s*,?\s*)?)?from\s+['"](.*?)['"];?/gm;

interface ModuleInfo {
  id: number;
  absolutePath: string;
  dependencies: number[]; // List of module IDs this module depends on
}

interface GraphData {
  nodes: { id: number; label: string; path: string }[];
  links: { source: number; target: number }[];
}

// --- Core Logic ---

const pathToId = new Map<string, number>();
const idToLabel = new Map<number, string>();
let nextId = 0;

/**
 * Gets a unique, stable numeric ID for a given absolute file path.
 * If the path hasn't been seen before, it's added to the map and a new ID is generated.
 */
function getIdForPath(absolutePath: string): number {
  if (!pathToId.has(absolutePath)) {
    pathToId.set(absolutePath, nextId++);
  }
  return pathToId.get(absolutePath)!;
}

/**
 * The main function to build the dependency graph from a starting directory.
 */
async function buildDependencyGraph(startDir: string): Promise<GraphData> {
  const allModules = new Map<number, ModuleInfo>();

  console.log(`🔍 Scanning directory recursively: ${startDir}`);

  // --- Pass 1: Discover all JS files and parse their dependencies ---
  try {
    for await (
      const entry of walk(startDir, {
        includeFiles: true,
        includeDirs: false,
        exts: [".js"],
      })
    ) {
      const absolutePath = path.resolve(entry.path);
      const currentModuleId = getIdForPath(absolutePath);

      const content = await Deno.readTextFile(absolutePath);
      const dependencies = new Set<number>();
    
      try {

        /*
        const ast = bblp.parse(content, {
          sourceType: "module",
          plugins: ["typescript"], // Allow TS syntax just in case
        });

        traverse(ast, {
          ImportDeclaration(astPath: NodePath<t.ImportDeclaration>) {
            const importSource = astPath.node.source.value;

            // Resolve the relative path to an absolute path
            const currentDir = path.dirname(absolutePath);
            const targetAbsolutePath = path.resolve(currentDir, importSource);

            // Get the ID for the dependency
            const dependencyId = getIdForPath(targetAbsolutePath);
            dependencies.add(dependencyId);

            // Check for a default import to set the label for the *target* module
            const defaultSpecifier = astPath.node.specifiers.find(
              (s) => t.isImportDefaultSpecifier(s),
            );
            if (defaultSpecifier) {
              const label = defaultSpecifier.local.name;
              // We might see a file imported with different names.
              // For simplicity, the last one seen wins. A more complex
              // strategy could count occurrences.
              idToLabel.set(dependencyId, label);
            }
          },
        });
        */

        let match;
        while ((match = IMPORT_REGEX.exec(content)) !== null) {
            // match[1] is the optional default import name (the label)
            // match[2] is the required relative path
            const defaultImportName = match[1];
            const relativePath = match[2];

            if (relativePath) {
            const currentDir = path.dirname(absolutePath);
            const targetAbsolutePath = path.resolve(currentDir, relativePath);
            const dependencyId = getIdForPath(targetAbsolutePath);
            dependencies.add(dependencyId);

            if (defaultImportName) {
                idToLabel.set(dependencyId, defaultImportName);
            }
            }
        }

        allModules.set(currentModuleId, {
          id: currentModuleId,
          absolutePath,
          dependencies: [...dependencies],
        });
        console.log(`   Processed ${path.basename(absolutePath)} (ID: ${currentModuleId})`);

      } catch (parseError) {
        console.warn(`   ⚠️  Could not parse ${absolutePath}: ${parseError.message}`);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`❌ Error: Directory '${startDir}' not found.`);
    } else {
      console.error(`❌ Error reading directory '${startDir}':`, error);
    }
    throw error;
  }

  console.log(`✅ Processed ${allModules.size} module files.`);

  // --- Pass 2: Build the final graph data structure ---
  const graphData: GraphData = { nodes: [], links: [] };

  // Create nodes from every file we assigned an ID to
  for (const [absolutePath, id] of pathToId.entries()) {
    graphData.nodes.push({
      id,
      // Use the default import name as the label if we found one, otherwise fallback to the filename
      label: idToLabel.get(id) || path.basename(absolutePath),
      path: absolutePath,
    });
  }

  // Create links (edges) from the parsed dependency information
  for (const moduleInfo of allModules.values()) {
    for (const depId of moduleInfo.dependencies) {
    //   // Ensure the link target exists as a node before adding the link
    //   if (pathToId.has(path.fromFileUrl(path.toFileUrl(depId.toString())))) { // This check is a bit redundant given our logic, but safe
    //     graphData.links.push({
    //       source: moduleInfo.id,
    //       target: depId,
    //     });
    //   }
     graphData.links.push({
        source: moduleInfo.id,
        target: depId,
      });
    }
  }

  graphData.nodes.sort((a, b) => a.id - b.id);

  console.log(`📊 Graph built: ${graphData.nodes.length} nodes, ${graphData.links.length} links.`);
  return graphData;
}

// --- Main execution block ---
async function main() {
  const startDir = Deno.args[0];
  if (!startDir) {
    console.error("❌ Error: Please provide a starting directory.");
    console.error("Usage: deno run --allow-read --allow-write es-deps-graph-builder.ts <directory>");
    Deno.exit(1);
  }
  const outputFile = "source-dependency-graph.json";

    const graphData = await buildDependencyGraph(startDir);
    await Deno.writeTextFile(outputFile, JSON.stringify(graphData, null, 2));
    console.log(`✅ Dependency graph saved to '${outputFile}'`);
    console.log("💡 You can now use this JSON file with visualization tools like D3.js or ngraph.");

}

if (import.meta.main) {
  main();
}