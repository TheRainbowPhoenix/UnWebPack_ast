import { ensureDir } from "jsr:@std/fs/ensure-dir";
import { exists } from "jsr:@std/fs/exists";
import WebpackParser from "./webpackParser.ts";

import _generator from "npm:@babel/generator";
const generator = _generator.default;

import { ESLint } from "npm:eslint";
import prettier from "npm:prettier";
import eslintConfig from "./eslintConfig.ts";

// super-simple comment stripper (no deps)
function stripJsoncSimple(raw: string): string {
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return noLine;
}

async function loadAliasesJsonc(filePath: string) {
  const raw = await Deno.readTextFile(filePath);
  const clean = stripJsoncSimple(raw);
  return JSON.parse(clean);
}

async function start() {
  const inFile = "../../flare.rive.app/lib/Components.3babdd1411e10d21748a.js";

  console.log("Reading files...");

  if (!(await exists(inFile))) {
    console.error(`${inFile} does not exist!`);
    Deno.exit(1);
  }

  await ensureDir("out");

  const eslint = new ESLint({
    fix: true,
    ignore: false,
    useEslintrc: false,
    extensions: [".js", ".jsx"],
    overrideConfig: eslintConfig,
  });

  const aliases = await loadAliasesJsonc("webpack-aliases.jsonc");
  const parser = new WebpackParser();
  parser.setAliasMap(aliases);

  if (await parser.isParseable(inFile)) {
    console.log(`Parsing ${inFile}...`);
    const modules = await parser.parse(inFile);

    // Use a for...of loop to handle async operations sequentially
    for (const mod of modules) {
      if (mod.file == null) continue;

      let code = generator(mod.element.node).code;

      // Doing ESLint
      try {
        const [lintResult] = await eslint.lintText("export default " + code);
        if (lintResult && lintResult.messages.length > 0) {
          for (const msg of lintResult.messages) {
            console.warn(`At line ${msg.line} : ${msg.message}`);
          }
        }
        code = lintResult?.output ?? code;
      } catch (e) {
        console.error("Error during linting:", e);
      }

      // Doing Prettier
      try {
        code = await prettier.format(code, {
          parser: "babel",
          singleQuote: true,
          printWidth: 180,
        });
      } catch (e) {
        console.error("Error during formatting:", e);
      }

      // Writing code
      const filePath = `out/mod_${mod.i}.js`;
      const currentContent = (await exists(filePath))
        ? await Deno.readTextFile(filePath)
        : null;

      if (currentContent !== code) {
        console.log(`>> Generating ${filePath}...`);
        await Deno.writeTextFile(filePath, code);
      }
    }
  }
}

start();