const fs = require("node:fs");

const jsfile = process.argv[2];
let contents = fs.readFileSync(jsfile).toString();

const goodPart = `if(isAsyncifyExport){Asyncify.asyncExports.add(original);`;
const badPart =  `Asyncify.asyncExports.add(original);if(isAsyncifyExport){`;

const isGood = contents.indexOf(goodPart) !== -1;
const isBad = contents.indexOf(badPart) !== -1;

if (contents.indexOf(`Asyncify.asyncExports`) !== -1) {
  if (isBad) {
    contents = contents.replace(badPart, goodPart);
    fs.writeFileSync(jsfile + ".tmp", contents);
    fs.renameSync(jsfile + ".tmp", jsfile);
    console.log(`Applied emscripten 3.1.43 fix`)
  } else if (!isGood) {
    console.error(`Don't know whether to apply the emscripten 3.1.43 fix`);
    process.exit(1);
  }
}
