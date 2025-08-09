// deps-graph-builder.ts
// Run with: deno run --allow-read --allow-write deps-graph-builder.ts

const DEPENDENCY_REGEX = /__webpack_require__\(\s*(\d+)\s*\)/g;
const MODULE_FILE_REGEX = /^mod_(\d+)\.js$/;

interface ModuleInfo {
  id: number; // The module ID (e.g., 245 from mod_245.js)
  file: string; // The filename (e.g., mod_245.js)
  dependencies: number[]; // List of module IDs this module depends on
}

interface GraphData {
  nodes: { id: number; label?: string; file?: string }[];
  links: { source: number; target: number }[];
}

async function buildDependencyGraph(outputDir: string): Promise<GraphData> {
  const modules: Map<number, ModuleInfo> = new Map();
  const decoder = new TextDecoder("utf-8");

  console.log(`🔍 Scanning directory: ${outputDir}`);

  try {
    for await (const dirEntry of Deno.readDir(outputDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".js")) {
        const match = dirEntry.name.match(MODULE_FILE_REGEX);
        if (match) {
          const moduleId = parseInt(match[1], 10);
          const filePath = `${outputDir}/${dirEntry.name}`;

          // Read file content
          const fileData = await Deno.readFile(filePath);
          const content = decoder.decode(fileData);

          // Find dependencies using regex
          const dependencies: number[] = [];
          let depMatch;
          while ((depMatch = DEPENDENCY_REGEX.exec(content)) !== null) {
            dependencies.push(parseInt(depMatch[1], 10));
          }

          // Store module info (deduplicating if somehow processed twice)
          if (!modules.has(moduleId)) {
            modules.set(moduleId, {
              id: moduleId,
              file: dirEntry.name,
              dependencies: [...new Set(dependencies)], // Remove duplicates within a file
            });
            console.log(`   Found mod_${moduleId}.js with ${dependencies.length} unique dependencies`);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`❌ Error: Directory '${outputDir}' not found.`);
    } else {
      console.error(`❌ Error reading directory '${outputDir}':`, error);
    }
    throw error; // Re-throw to stop execution
  }

  console.log(`✅ Processed ${modules.size} module files.`);

  // --- Build Graph Data ---
  const graphData: GraphData = { nodes: [], links: [] };
  const moduleIds = new Set(modules.keys());

  // Create nodes
  for (const moduleInfo of modules.values()) {
    graphData.nodes.push({
      id: moduleInfo.id,
      label: `mod_${moduleInfo.id}`, // Optional label for visualization
      file: moduleInfo.file,        // Optional filename for visualization
    });
  }

  // Create links (edges)
  for (const moduleInfo of modules.values()) {
    for (const depId of moduleInfo.dependencies) {
      // Optional: Only create links if the target module also exists in our output
      // Uncomment the next line if you want to filter out external/unseen deps
      // if (moduleIds.has(depId)) {
        graphData.links.push({
          source: moduleInfo.id,
          target: depId,
        });
      // }
    }
  }

  console.log(`📊 Graph built: ${graphData.nodes.length} nodes, ${graphData.links.length} links.`);

  return graphData;
}

async function main() {
  // Default to 'out' directory, or take the first argument
  const outputDir = Deno.args[0] || "out";
  const outputFile = "dependency-graph.json";

  try {
    const graphData = await buildDependencyGraph(outputDir);
    await Deno.writeTextFile(outputFile, JSON.stringify(graphData, null, 2));
    console.log(`✅ Dependency graph saved to '${outputFile}'`);
    console.log("💡 You can now use this JSON file with visualization tools like D3.js or SvelteFlow.");
  } catch (err) {
    console.error("❌ Failed to build dependency graph:", err);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}