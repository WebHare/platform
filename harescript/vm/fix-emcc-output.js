/* We patch harescript.js for known emscripten issues */

const fs = require("node:fs");

const jsfile = process.argv[2];
let contents = fs.readFileSync(jsfile).toString();
const orgContents = fs.readFileSync(jsfile).toString();
fs.writeFileSync(jsfile + ".org", orgContents);

let numfixes = 0, numapplied = 0;
let groups = {};

function applyFix(title, match, badPart, goodPart, group, altGoodParts) {
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
      if (group) {
        if (groups[group] === false) {
          console.error(`fix-emcc-output: Not all fixes of group ${group} applied`);
          process.exit(1);
        }
        groups[group] = true;
      }
    } else if (!isGood) {
      console.error(`fix-emcc-output: Don't know how to apply fix: ${title}`);
      process.exit(1);
    }
  } else {
    console.log(`fix-emcc-output: Not applied fix: ${title}`);
    if (group) {
      if (groups[group] === true) {
        console.log(`orgContents`);
        console.log(orgContents);
        console.log(`contents`);
        console.log(contents);
        console.error(`fix-emcc-output: Not all fixes of group ${group} applied`);
        process.exit(1);
      }
      groups[group] === false;
    }
  }
}

const nodeMajor = parseInt(process.env["WEBHARE_NODE_MAJOR"]);
if (Number.isNaN(nodeMajor))
  throw new Error(`WEBHARE_NODE_MAJOR not properly set`); //not using process.version as then we're not under WebHare build control

applyFix('emscripten 3.1.43 fix', /Asyncify.asyncExports/,
  `Asyncify.asyncExports.add(original);if(isAsyncifyExport){`,
  `if(isAsyncifyExport){Asyncify.asyncExports.add(original);`,
  null,
  [/if *\(isAsyncifyExport\) *{\n? *Asyncify.asyncExports.add\(original\);/m]);

if (nodeMajor >= 21 && nodeMajor <= 22) { //apply patches to resolve https://gitlab.webhare.com/webharebv/codekloppers/-/issues/941 but https://gitlab.webhare.com/webharebv/codekloppers/-/issues/967 is now blocking updates to 21+ again

  applyFix('add hook for fixing async hook behaviour, for async imports (debug)', /if \(isAsyncifyImport\) {\n *let type = sigToWasmTypes\(original.sig\);\n *\/\/ Add space/m,
    `let type = sigToWasmTypes\(original.sig\);\n`,
    `/*modified by fix-emcc-output.js*/\n              let type = sigToWasmTypes\(original.sig\);\n              if (Module.fixAsyncImportForAsyncStorage)\n                original = Module.fixAsyncImportForAsyncStorage(original);\n`,
    "node-21-debug");

  applyFix('add hook for fixing async hook behaviour, for sync imports (debug)', /{ suspending: 'first' }\n *\);\n *}\n *}/m,
    `{ suspending: 'first' }\n              );\n            }\n          }`,
    `{ suspending: 'first' }\n              );\n            } /*modified by fix-emcc-output.js*/ else if (Module.fixSyncImportForAsyncStorage) {\n              imports[x] = original = Module.fixSyncImportForAsyncStorage(original);\n            }\n          }`,
    "node-21-debug");

  applyFix('add hook for fixing async hook behaviour, for sync exports (debug)', /return new WebAssembly.Function\(\n *{ parameters/m,
    `return new WebAssembly.Function(\n          { parameters , results: ['externref'] },\n          original,\n          { promising : 'first' });\n`,
    `/*modified by fix-emcc-output.js*/\n          var retval = new WebAssembly.Function(\n          { parameters , results: ['externref'] },\n          original,\n          { promising : 'first' });\n        if (Module.fixAsyncExportForAsyncStorage)\n          retval = Module.fixAsyncExportForAsyncStorage(retval);\n        return retval;\n`,
    "node-21-debug");

  applyFix('add hook for fixing async hook behaviour, for async imports (prod)', /{let type=sigToWasmTypes\(original.sig\)/m,
    `let type=sigToWasmTypes\(original.sig\);`,
    `/*modified by fix-emcc-output.js*/let type=sigToWasmTypes\(original.sig\);if(Module.fixAsyncImportForAsyncStorage)original=Module.fixAsyncImportForAsyncStorage(original);`,
    "node-21-prod");

  applyFix('add hook for fixing async hook behaviour, for sync imports (prod)', /{suspending:"first"}\)}}/m,
    `{suspending:"first"})}}`,
    `{suspending:"first"})}/*modified by fix-emcc-output.js*/else if(Module.fixSyncImportForAsyncStorage){imports[x]=original=Module.fixSyncImportForAsyncStorage(original);}}`,
    "node-21-prod");

  applyFix('add hook for fixing async hook behaviour, for exports (prod)', /return new WebAssembly.Function\({parameters/m,
    `return new WebAssembly.Function({parameters:parameters,results:["externref"]},original,{promising:"first"})`,
    `/*modified by fix-emcc-output.js*/var retval=new WebAssembly.Function({parameters:parameters,results:["externref"]},original,{promising:"first"});if(Module.fixAsyncExportForAsyncStorage)retval=Module.fixAsyncExportForAsyncStorage(retval);return retval`,
    "node-21-prod");
} //ends 21-22 fixes

if (nodeMajor >= 23 && nodeMajor < 24) { //apply patches to resolve https://gitlab.webhare.com/webharebv/codekloppers/-/issues/941
  // debug build
  applyFix('add hook for fixing async hook behaviour, for imports (debug)', /new WebAssembly.Suspending\(original\);\n            }\n/m,
    `// Wrap async imports with a suspending WebAssembly function.\n            if (isAsyncifyImport) {\n              imports[x] = original = new WebAssembly.Suspending(original);\n            }\n`,
    `// Wrap async imports with a suspending WebAssembly function.\n            if (isAsyncifyImport) {\n              /*modified by fix-emcc-output.js*/\n              if (Module.fixAsyncImportForAsyncStorage)\n                original = Module.fixAsyncImportForAsyncStorage(original);\n              imports[x] = original = new WebAssembly.Suspending(original);\n            }/*modified by fix-emcc-output.js*/ else if (Module.fixSyncImportForAsyncStorage)\n              imports[x] = original = Module.fixSyncImportForAsyncStorage(original);\n`,
    "node-23-debug");

  applyFix('add hook for fixing async hook behaviour, for async exports (debug)', /  return WebAssembly.promising\(original/m,
    `{\n        return WebAssembly.promising(original);`,
    `{\n        /*modified by fix-emcc-output.js*/\n        var retval = WebAssembly.promising(original);\n        if (Module.fixAsyncExportForAsyncStorage)\n          retval = Module.fixAsyncExportForAsyncStorage(retval);\n        return retval;`,
    "node-23-debug");

  applyFix('add hook for fixing async hook behaviour, for sync dynamic exports (debug)', /func = Asyncify.makeAsyncFunction\(func\);\n        }\n/m,
    `wasmTableMirror[funcPtr] = func = Asyncify.makeAsyncFunction(func);\n        }\n      }`,
    `wasmTableMirror[funcPtr] = func = Asyncify.makeAsyncFunction(func);\n        } /*modified by fix-emcc-output.js*/ else  if (Module.fixSyncExportForAsyncStorage)\n          wasmTableMirror[funcPtr] = func = Module.fixSyncExportForAsyncStorage(func);\n      }`,
    contents.match(/wasmTableMirror/) ? "node-23-debug" : null); // blex tests don't have wasmTableMirror

  applyFix('add hook for fixing async hook behaviour, for sync static exports (debug)', /original = Asyncify.makeAsyncFunction\(original\);\n            }\n/m,
    `original = Asyncify.makeAsyncFunction(original);\n            }\n`,
    `original = Asyncify.makeAsyncFunction(original);\n            } /*modified by fix-emcc-output.js*/ else if (Module.fixSyncExportForAsyncStorage)\n              original = Module.fixSyncExportForAsyncStorage(original);\n`,
    "node-23-debug");

  // prod build
  applyFix('add hook for fixing async hook behaviour, for imports (prod)', /if\(isAsyncifyImport\){imports/m,
    `if(isAsyncifyImport){imports[x]=original=new WebAssembly.Suspending(original)}}`,
    `if(isAsyncifyImport){/*modified by fix-emcc-output.js*/if(Module.fixAsyncImportForAsyncStorage)original=Module.fixAsyncImportForAsyncStorage(original);imports[x]=original=new WebAssembly.Suspending(original);}/*modified by fix-emcc-output.js*/else if (Module.fixSyncImportForAsyncStorage)imports[x]=original=Module.fixSyncImportForAsyncStorage(original)}`,
    "node-23-prod");

  applyFix('add hook for fixing async hook behaviour, for async exports (prod)', /{return WebAssembly.promising\(original/m,
    `{return WebAssembly.promising(original)}`,
    `{/*modified by fix-emcc-output.js*/var retval=WebAssembly.promising(original);if(Module.fixAsyncExportForAsyncStorage)retval=Module.fixAsyncExportForAsyncStorage(retval);return retval}`,
    "node-23-prod");

  applyFix('add hook for fixing async hook behaviour, for sync dynamic exports (prod)', /func=Asyncify.makeAsyncFunction\(func\)}}/m,
    `wasmTableMirror[funcPtr]=func=Asyncify.makeAsyncFunction(func)}}`,
    `wasmTableMirror[funcPtr]=func=Asyncify.makeAsyncFunction(func)}/*modified by fix-emcc-output.js*/else if(Module.fixSyncExportForAsyncStorage)wasmTableMirror[funcPtr]=func=Module.fixSyncExportForAsyncStorage(func)}`,
    contents.match(/wasmTableMirror/) ? "node-23-prod" : null); // blex tests don't have wasmTableMirror

  applyFix('add hook for fixing async hook behaviour, for sync static exports (prod)', /original=Asyncify.makeAsyncFunction\(original\)}ret/m,
    `original=Asyncify.makeAsyncFunction(original)}`,
    `original=Asyncify.makeAsyncFunction(original)}/*modified by fix-emcc-output.js*/else if(Module.fixSyncExportForAsyncStorage)original=Module.fixSyncExportForAsyncStorage(original);`,
    "node-23-prod");
}
console.log(`fix-emcc-output: Needed to apply ${numapplied} of ${numfixes} known fixes.`);
