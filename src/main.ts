import fsExtra from "fs-extra";
import WebpackParser from "./webpackParser";

async function start() {
  let inFile = "../test.min.js";

  console.log("Reading files...");

  if (!fsExtra.existsSync(inFile)) {
    console.log(`${inFile} not exist!`);
    process.exit(1);
  }

  let parser = new WebpackParser();
  if (await parser.isParseable(inFile)) {
    console.log(`Parsing ${inFile}...`);
    /*let out =*/ await parser.parse(inFile);
    // console.log(out);
    // console.log(out[0].element.opts);
  }

  // await fileParserRouter.route(argValues);
}

start();
