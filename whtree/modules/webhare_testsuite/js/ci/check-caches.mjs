/* we use plain JS so plain node can run us without triggering any TS cache/compilation

   wh run mod::webhare_testsuite/js/ci/check-caches.mjs record /tmp/cacheinfo
   wh run mod::webhare_testsuite/js/ci/check-caches.mjs verify /tmp/cacheinfo
*/
import * as fs from "node:fs";

if (!process.env.WEBHARE_COMPILECACHE)
  throw new Error("WEBHARE_COMPILECACHE not set");

const isVerify = process.argv[2] === 'verify';
if (!isVerify && process.argv[2] !== 'record')
  throw new Error("Invalid arguments - expected 'record' or 'verify'");

const path = process.argv[3];
if (!path)
  throw new Error("Invalid arguments - expected path to data file");

const previousData = isVerify ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};

const scandirs = [
  process.env.WEBHARE_COMPILECACHE
];

const entries = [];
for (const dir of scandirs) {
  entries.push(...fs.readdirSync(dir, { withFileTypes: true, recursive: true }).
    filter(entry => !entry.isDirectory()).
    map(entry => ({
      parentPath: entry.parentPath,
      name: entry.name,
      modtime: fs.statSync(entry.parentPath + "/" + entry.name).mtime.getTime()
    })));
}

if (isVerify) {
  for (const entry of entries) {
    const previousEntry = previousData.entries.find(prevEntry => prevEntry.parentPath === entry.parentPath && prevEntry.name === entry.name);
    if (!previousEntry)
      continue; //it's a new file, we don't care about that yet

    if (previousEntry.modtime !== entry.modtime) {
      process.exitCode = 1;
      console.log(`File ${entry.parentPath}/${entry.name} has changed: ${new Date(previousEntry.modtime).toISOString()} -> ${new Date(entry.modtime).toISOString()}`);
    }
  }
}

if (!isVerify)
  fs.writeFileSync(path, JSON.stringify({ entries }, null, 2));
