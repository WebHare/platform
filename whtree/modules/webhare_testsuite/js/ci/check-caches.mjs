/* we use plain JS so plain node can run us without triggering any TS cache/compilation

   wh run mod::webhare_testsuite/js/ci/check-caches.mjs record /tmp/cacheinfo
   wh run mod::webhare_testsuite/js/ci/check-caches.mjs verify /tmp/cacheinfo
*/
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";

async function main() {
  if (!process.env.WEBHARE_DIR)
    throw new Error("WEBHARE_DIR not set");
  if (!process.env.WEBHARE_DATAROOT)
    throw new Error("WEBHARE_DATAROOT not set");

  const esbuild = await import(process.env.WEBHARE_DIR + "/node_modules/esbuild/lib/main.js");

  const isVerify = process.argv[2] === 'verify';
  if (!isVerify && process.argv[2] !== 'record')
    throw new Error("Invalid arguments - expected 'record' or 'verify'");

  const stateFilePath = process.argv[3];
  if (!stateFilePath)
    throw new Error("Invalid arguments - expected path to data file");

  const previousData = isVerify ? JSON.parse(fs.readFileSync(stateFilePath, 'utf8')) : {};

  const scandirs = [
    process.env.WEBHARE_DIR + "/currentinstall/",
    process.env.WEBHARE_DIR + "/modules/platform/generated/"
  ];

  const entries = [];
  for (const dir of scandirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isDirectory())
        continue;

      try {
        const stat = fs.statSync(entry.parentPath + "/" + entry.name);
        entries.push({
          parentPath: entry.parentPath,
          name: entry.name,
          fullPath: entry.parentPath + "/" + entry.name,
          modtime: stat.mtime.getTime()
        });
      } catch (e) {
        if (e.code === 'ENOENT') //disappeared during dirscan and seeing it here? some lingering compile request while tests were already finished?
          continue;
        throw e;
      }
    }
  }

  //TODO share with resolvehook.ts? but then we *do* need a precompile step (or experimental strip types..)
  function getHashForPath(filename) {
    return crypto
      .createHash("md5")
      .update(path.resolve(filename)) //ensures its absolute
      .update(process.version) //also keys on node version
      .update(esbuild.version) //and esbuild's version
      .digest("hex");
  }

  if (isVerify) {
    //Hash all paths in the installation root so we can find typescript cached files
    const hashes = new Map;
    //Which directories contain source files that we need to hash?
    const sourcedirs = [
      process.env.WEBHARE_DIR,
      process.env.WEBHARE_DATAROOT + "/storage/",
      process.env.WEBHARE_DATAROOT + "/installedmodules/"
    ];

    for (const source of sourcedirs) {
      for (const entry of fs.readdirSync(source, { withFileTypes: true, recursive: true })) {
        const fullpath = entry.parentPath + "/" + entry.name;
        hashes.set(getHashForPath(fullpath), fullpath);
      }
    }

    for (const entry of entries) {
      const previousEntry = previousData.entries.find(prevEntry => prevEntry.parentPath === entry.parentPath && prevEntry.name === entry.name);
      if (previousEntry?.modtime === entry.modtime)
        continue; //seen before, unchanged, ok!

      if (!previousEntry) { //it's a new file.
        if (entry.fullPath.match(/harescript\/.*installedmodules/) || entry.name.match(/^direct__opt_whdata_storage_webhare__testsuite.*/))
          continue; //its okay for webhare_testsuite and temp modules to be added to the cache
        if (entry.fullPath.match(/hsvmtemp[0-9a-f]{40}\.whscr\.clib$/))
          continue; //ignore `wh sql` temporaries
        if (entry.name.match(/^direct__opt_whdata_ephemeral_system\.dbcode_.*clib$/) || entry.name.match(/^direct__opt_whdata_output_.*clib$/))
          continue; //ignore files that represent SHTML/WHLIBS from whfs serialized to disk (although that should go away completely for safety - unsigned generated code close to the webserver output is dangerous)
        if (entry.fullPath.startsWith(process.env.WEBHARE_DIR + "/currentinstall/pg/"))
          continue; //ignore socket files
      }

      // If it's a compiled typescript file, figure out the source file through the sourcemap
      let mapsto;

      if (entry.name.match(/^[0-9a-f]{32}\.js$/)) {
        const file = fs.readFileSync(entry.fullPath, 'utf8');
        const sourcemapline = file.split('\n').find(line => line.startsWith(`//# sourceMappingURL=data:application/json;base64`));
        if (sourcemapline) {
          const smap = JSON.parse(atob(sourcemapline.substring(sourcemapline.indexOf(',') + 1)));
          mapsto = smap?.sources?.[0];
        }
      }

      if (!previousEntry) { //so it's still a new file and..
        if (mapsto?.match(/\/installedmodules\//))
          continue; //ignore installed modules - its okay for webhare_testsuite and temp modules to be added to the cache

        if (mapsto?.match(/^\/opt\/whdata\/config/))
          continue; //ignore TS files in configuration
      }

      process.exitCode = 1;
      if (previousEntry)
        console.log(`File ${entry.fullPath} has changed: ${new Date(previousEntry.modtime).toISOString()} -> ${new Date(entry.modtime).toISOString()}}${mapsto ? ` (maps to ${mapsto})` : ''}`);
      else
        console.log(`File ${entry.fullPath} has appeared: ${new Date(entry.modtime).toISOString()}${mapsto ? ` (maps to ${mapsto})` : ''}`);

    }
  } else { //recording, not verifying
    fs.writeFileSync(stateFilePath, JSON.stringify({ entries }, null, 2));
  }
}

main();
