import fsExtra from "fs-extra";
import WebpackParser from "./webpackParser";
import generator from "@babel/generator";
import { ESLint } from "eslint";
import prettier from "prettier";
import eslintConfig from "./eslintConfig";

async function start() {
  let inFile = "../flare.rive.app/lib/Components.3babdd1411e10d21748a.js"; // "./test/test.min.js";
  // let inFile = "../flare.rive.app/lib/vendor.max.js"; // "./test/test.min.js";

  console.log("Reading files...");

  if (!fsExtra.existsSync(inFile)) {
    console.log(`${inFile} not exist!`);
    process.exit(1);
  }

  fsExtra.ensureDirSync("out");

  const eslint = new ESLint({
    fix: true,
    ignore: false,
    useEslintrc: false,
    extensions: [".js", ".jsx"],
    overrideConfig: eslintConfig,
  });

  let parser = new WebpackParser();
  if (await parser.isParseable(inFile)) {
    console.log(`Parsing ${inFile}...`);
    let modules = await parser.parse(inFile);
    modules.forEach(async (mod) => {
      let code = generator(mod.element.node).code;
      
      // Doing ESLint
      try {
        const lintedCode = await eslint.lintText("export default " + code);
        if (lintedCode[0].messages.length >0 ) {
          for (let msg of lintedCode[0].messages) {
            console.warn(`At line ${msg.line} : ${msg.message}`)
          }
        }
        code = lintedCode[0].output ?? code;
      } catch (e) {}

      // Doing Prettier
      try {
        code = prettier.format(code, {
          parser: "babel",
          singleQuote: true,
          printWidth: 180,
        });
      } catch (e) {}

      // Writing code
      if (mod.file == null) return;
      const filePath = `out/mod_${mod.i}.js`;
      if (
        !fsExtra.existsSync(filePath) ||
        fsExtra.readFileSync(filePath, "utf-8") !== code
      ) {
        console.log(`>> Generating ${filePath}...`);
        fsExtra.writeFileSync(filePath, code);
      }
    });

    // console.log(out);
    // console.log(out[0].element.opts);
  }

  // await fileParserRouter.route(argValues);
}

start();
