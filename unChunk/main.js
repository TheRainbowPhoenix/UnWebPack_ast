const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

// Load the JavaScript code from the file
const filePath = "./test.js";
// const filePath = "../your-app/vendor.min.js";
const code = fs.readFileSync(filePath, 'utf-8');

const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx', 'flow'],
});

let chunksArray = [];
let chunksDict = {};

function parseObject(objectExpression) {

  // Extract the keys (file names) and values (file content) from the object
  const entries = objectExpression.properties.map(prop => {
    const key = prop.key.value; // Assuming the keys are string literals
    const value = generate(prop.value).code;
    return { key, value };
  });

  // Create a dictionary (object) with file names as keys and file content as values
  entries.forEach(entry => {
    chunksDict[entry.key] = entry.value;
  });
}

function parseArray(childs) {
  chunksArray.push(...childs);
}

for (const node of ast.program.body) {
  if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression?.callee?.property?.name === 'push') {
    let parentArray = node.expression?.arguments[0];

    if (parentArray.type === 'ArrayExpression' && parentArray.elements) {
      let childs = node.expression?.arguments[0]?.elements;
      console.log(childs?.length);

      if (childs[1].type === "ObjectExpression") {
        parseObject(childs[1]);

      } else if(childs[1].type === 'ArrayExpression') {
        parseArray(childs[1].elements);

      } else if (childs[1].type === 'CallExpression' && childs[1]?.callee?.type === 'MemberExpression' &&
      childs[1].callee.object.type === 'CallExpression' && childs[1].callee.object.callee.type === 'Identifier' && childs[1].callee.object.callee.name === 'Array') {
        // Array(20).conact([...])
        if (childs[1].callee.object.arguments[0].type === 'NumericLiteral') {
          let arrayPad = childs[1].callee.object.arguments[0].value;
          chunksArray = Array(arrayPad);

          parseArray(childs[1].arguments[0].elements);

        } else {
          console.error("Unknown object :/ ")
        }
      }
    }

    
  } else if (node.type === 'ExpressionStatement' && node.expression.type === 'UnaryExpression' && node.expression?.operator === '!') {
    /*
      !function(e) {
      // JUNK
      }({
          1: "FLAG"
      });
    */
    if (node.expression?.argument && node.expression?.argument?.arguments[0].type === 'ObjectExpression') {
      parseObject(node.expression?.argument.arguments[0]);
    }
  }
}

const chunksDir = 'chunks';
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir);
}

for (let i = 0; i < chunksArray.length; i++) {
  const chunk = chunksArray[i];

  if (chunk) {
    const chunkCode = generate(chunk).code;
    const outputPath = `${chunksDir}/chunk_${i}.js`;
    fs.writeFileSync(outputPath, chunkCode, 'utf-8');
    console.log(`Chunk ${i} saved as ${outputPath}`);
  }
}

for (const key in chunksDict) {
  if (chunksDict.hasOwnProperty(key)) {
    const chunkCode = chunksDict[key];
    const outputPath = `${chunksDir}/chunk_${key}.js`;
    fs.writeFileSync(outputPath, chunkCode, 'utf-8');
    console.log(`Chunk ${key} saved as ${outputPath}`);
  }
}