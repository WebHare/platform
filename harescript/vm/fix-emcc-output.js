/* We patch harescript.js for known emscripten issues */

const fs = require("node:fs");

const jsfile = process.argv[2];
let contents = fs.readFileSync(jsfile).toString();
let numfixes = 0, numapplied = 0;

function applyFix(title, match, badPart, goodPart) {
  const isGood = contents.indexOf(goodPart) !== -1;
  const isBad = contents.indexOf(badPart) !== -1;

  ++numfixes;
  if (contents.match(match)) {
    if (isBad) {
      contents = contents.replace(badPart, goodPart);
      fs.writeFileSync(jsfile + ".tmp", contents);
      fs.renameSync(jsfile + ".tmp", jsfile);
      console.log(`fix-emcc-output: Applied fix: ${title}`);
      ++numapplied;
    } else if (!isGood) {
      console.error(`fix-emcc-output: Don't know how to apply fix: ${title}`);
      process.exit(1);
    }
  }
}

applyFix('emscripten 3.1.43 fix', /Asyncify.asyncExports/,
  `Asyncify.asyncExports.add(original);if(isAsyncifyExport){`,
  `if(isAsyncifyExport){Asyncify.asyncExports.add(original);`);

// https://github.com/emscripten-core/emscripten/pull/20213
applyFix('fix removeFunction reference leak', /removeFunction/,
  `functionsInTableMap.delete(getWasmTableEntry(index));freeTableIndexes.push(index)`,
  `functionsInTableMap.delete(getWasmTableEntry(index));setWasmTableEntry(index,null);freeTableIndexes.push(index)`);

console.log(`fix-emcc-output: Needed to apply ${numapplied} of ${numfixes} known fixes.`);
