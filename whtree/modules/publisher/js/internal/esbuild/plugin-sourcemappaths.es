/* Rewrites the paths in the sourcemap to /@whpath/mod::... paths
*/

"use strict";

const path = require('path');
const bridge = require('@mod-system/js/wh/bridge');

module.exports = (outdir) =>
 ({ name: "sourceMapTransformer"
  , setup: build =>
    {
      build.onEnd(result =>
      {
        const modulepaths = bridge.getModuleInstallationRoots();
        for (let file of result.outputFiles.filter(f => f.path.endsWith("/ap.js.map")))
        {
          const jsondata = JSON.parse(new TextDecoder("utf-8").decode(file.contents));
          for (let i = 0, e = jsondata.sources.length; i < e; ++i)
          {
            let fullpath = path.join(outdir, jsondata.sources[i]);
            let rewrotePath = false;

            for (const mod of modulepaths)
            {
              if (fullpath.startsWith(mod.path))
              {
                fullpath = `mod::${mod.name}/${fullpath.substr(mod.path.length)}`;
                rewrotePath = true;
                break;
              }
            }

            if (fullpath.startsWith(bridge.getBaseDataRoot()))
            {
              rewrotePath = true;
              fullpath = `whdata::${fullpath.substr(bridge.getBaseDataRoot().length)}`;
            }
            if (fullpath.startsWith(bridge.getInstallationRoot()))
            {
              rewrotePath = true;
              fullpath = `whinstallationroot::${fullpath.substr(bridge.getInstallationRoot().length)}`;
            }

            if (rewrotePath || fullpath.startsWith("/:"))
              jsondata.sources[i] = `/@whpath/${fullpath}`;
          }
          file.contents = new TextEncoder("utf-8").encode(JSON.stringify(jsondata));
        }
      });
    }
  });
