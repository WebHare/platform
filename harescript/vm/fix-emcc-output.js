/* We patch harescript.js for known emscripten issues */

const fs = require("node:fs");

const jsfile = process.argv[2];
let contents = fs.readFileSync(jsfile).toString();
let numfixes = 0, numapplied = 0;

function applyFix(title, match, badPart, goodPart, altGoodParts) {
  let isGood = contents.indexOf(goodPart) !== -1;
  if (altGoodParts)
    for (const part of altGoodParts)
      if (!isGood && contents.match(part))
        isGood = true;
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

const nodeMajor = parseInt(process.env["WEBHARE_NODE_MAJOR"]);
if(Number.isNaN(nodeMajor))
  throw new Error(`WEBHARE_NODE_MAJOR not properly set`); //not using process.version as then we're not under WebHare build control

applyFix('emscripten 3.1.43 fix', /Asyncify.asyncExports/,
  `Asyncify.asyncExports.add(original);if(isAsyncifyExport){`,
  `if(isAsyncifyExport){Asyncify.asyncExports.add(original);`,
  [/if *\(isAsyncifyExport\) *{\n? *Asyncify.asyncExports.add\(original\);/m]);

if(nodeMajor >= 21) { //apply patches to resolve https://gitlab.webhare.com/webharebv/codekloppers/-/issues/941 but https://gitlab.webhare.com/webharebv/codekloppers/-/issues/967 is now blocking updates to 21+ again

  applyFix('add hook for fixing async hook behaviour, for async imports (debug)', /if \(isAsyncifyImport\) {\n *let type = sigToWasmTypes\(original.sig\);\n *\/\/ Add space/m,
    `let type = sigToWasmTypes\(original.sig\);\n`,
    `/*modified by fix-emcc-output.js*/\n              let type = sigToWasmTypes\(original.sig\);\n              if (Module.fixAsyncImportForAsyncStorage)\n                original = Module.fixAsyncImportForAsyncStorage(original);\n`);

  applyFix('add hook for fixing async hook behaviour, for sync imports (debug)', /{ suspending: 'first' }\n *\);\n *}\n *}/m,
    `{ suspending: 'first' }\n              );\n            }\n          }`,
    `{ suspending: 'first' }\n              );\n            } /*modified by fix-emcc-output.js*/ else if (Module.fixSyncImportForAsyncStorage) {\n              imports[x] = original = Module.fixSyncImportForAsyncStorage(original);\n            }\n          }`);

  applyFix('add hook for fixing async hook behaviour, for sync exports (debug)', /return new WebAssembly.Function\(\n *{ parameters/m,
    `return new WebAssembly.Function(\n          { parameters , results: ['externref'] },\n          original,\n          { promising : 'first' });\n`,
    `/*modified by fix-emcc-output.js*/\n          var retval = new WebAssembly.Function(\n          { parameters , results: ['externref'] },\n          original,\n          { promising : 'first' });\n        if (Module.fixAsyncExportForAsyncStorage)\n          retval = Module.fixAsyncExportForAsyncStorage(retval);\n        return retval;\n`);

  applyFix('add hook for fixing async hook behaviour, for async imports (prod)', /{let type=sigToWasmTypes\(original.sig\)/m,
    `let type=sigToWasmTypes\(original.sig\);`,
    `/*modified by fix-emcc-output.js*/let type=sigToWasmTypes\(original.sig\);if(Module.fixAsyncImportForAsyncStorage)original=Module.fixAsyncImportForAsyncStorage(original);`);

    applyFix('add hook for fixing async hook behaviour, for sync imports (prod)', /{suspending:"first"}\)}}/m,
    `{suspending:"first"})}}`,
    `{suspending:"first"})}/*modified by fix-emcc-output.js*/else if(Module.fixSyncImportForAsyncStorage){imports[x]=original=Module.fixSyncImportForAsyncStorage(original);}}`);

  applyFix('add hook for fixing async hook behaviour, for exports (prod)', /return new WebAssembly.Function\({parameters/m,
    `return new WebAssembly.Function({parameters:parameters,results:["externref"]},original,{promising:"first"})`,
    `/*modified by fix-emcc-output.js*/var retval=new WebAssembly.Function({parameters:parameters,results:["externref"]},original,{promising:"first"});if(Module.fixAsyncExportForAsyncStorage)retval=Module.fixAsyncExportForAsyncStorage(retval);return retval`);
} //ends 21+ fixes

console.log(`fix-emcc-output: Needed to apply ${numapplied} of ${numfixes} known fixes.`);
