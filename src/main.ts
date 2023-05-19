import fsExtra from "fs-extra";
import WebpackParser from "./webpackParser";
import generator from "@babel/generator";

async function start() {
  let inFile = "./test/test.min.js";

  console.log("Reading files...");

  if (!fsExtra.existsSync(inFile)) {
    console.log(`${inFile} not exist!`);
    process.exit(1);
  }

  fsExtra.ensureDirSync("out");

  let parser = new WebpackParser();
  if (await parser.isParseable(inFile)) {
    console.log(`Parsing ${inFile}...`);
    let modules = await parser.parse(inFile);
    modules.forEach((mod) => {
      let code = generator(mod.element.node).code;

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
