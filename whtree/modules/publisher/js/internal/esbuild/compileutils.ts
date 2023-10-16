import * as fs from 'fs';
import * as path from 'path';
//import * as Module from 'module'; //FIXME this breaks resetResolveCache
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
import * as services from "@webhare/services";

export function resolveWebHareAssetPath(startingpoint: string, inpath: string) {
  if (inpath.startsWith("dompack/")) {
    return services.toFSPath("mod::system/js/" + inpath);
  }
  try {
    // https://nodejs.org/api/modules.html#modules_require_resolve_request_options
    let paths = [];
    if (startingpoint)
      paths.push(startingpoint);

    /* If the path starts with @mod-, we know it must be loaded from $DATAROOT/node_modules.
       Replace the inpath with the full path, and resolve the symlinks (because we can't reset the symlink
       resolve cache in the nodejs module loader). No need for startingpoint paths anymore, the inpath
       is absolute after this.
    */
    if (inpath.startsWith('@mod-')) {
      // The directory should exist, so we can realpath that part
      const inpathdir = path.join(services.backendConfig.dataroot, "node_modules/", path.dirname(inpath));
      inpath = path.join(fs.realpathSync(inpathdir), path.basename(inpath));
      paths = [];
    }

    // FIXME: this won't find files ending with .es, because the node process itself isn't configured with that extension
    return require.resolve(inpath, { paths });
  } catch (e) {
    // console.log("resolve failed");
    return null;
  }
}

/** Resets the path resolve cache, so changes in directory structure won't have effect */
export function resetResolveCache() {
  Module._pathCache = Object.create(null);
}
