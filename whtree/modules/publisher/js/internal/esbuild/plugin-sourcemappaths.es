/* Rewrites the paths in the sourcemap to /@whpath/mod::... paths
*/

"use strict";

const path = require('path');
const services = require("@webhare/services");

module.exports = (outdir) =>
 ({ name: "sourceMapTransformer"
  , setup: build =>
    {
      const config = services.getConfig();
      build.onEnd(result =>
      {
        for (let file of result.outputFiles.filter(f => f.path.endsWith("/ap.js.map")))
        {
          const jsondata = JSON.parse(new TextDecoder("utf-8").decode(file.contents));
          for (let i = 0, e = jsondata.sources.length; i < e; ++i)
          {
            let fullpath = path.join(outdir, jsondata.sources[i]);
            let rewrotePath = false;

            const attempt_toResourcePath = services.toResourcePath(fullpath, { allowUnmatched: true });
            if(attempt_toResourcePath) {
              fullpath = attempt_toResourcePath;
              rewrotePath = true;
              break;
            }

            //FIXME should services.toResourcePath do both of these? but especially whinstallationroot:: seems suspect!!
            if (fullpath.startsWith(config.dataroot))
            {
              rewrotePath = true;
              fullpath = `whdata::${fullpath.substring(config.dataroot.length)}`;
            }
            if (fullpath.startsWith(config.installationroot))
            {
              rewrotePath = true;
              fullpath = `whinstallationroot::${fullpath.substring(config.installationroot.length)}`;
            }

            if (rewrotePath || fullpath.startsWith("/:"))
              jsondata.sources[i] = `/@whpath/${fullpath}`;
          }
          file.contents = new TextEncoder("utf-8").encode(JSON.stringify(jsondata));
        }
      });
    }
  });
