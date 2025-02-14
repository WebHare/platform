/* This file exists for the benefit of IDEs pointed at the WebHare source tree
   eslint import plugin goes into a loop if tsconfigRootDir is set to a relative path
   but it can't find a tsconfig.json there or higher.

   RunESLint will use whtree/eslint.config.mjs (or versions in the data folder)

   `eslint` when invoked in the project root (and IDEs) both report errors on eg *.js files
   that checkmodule won't report due to the latter only validating *.ts and *.tsx
   Would be nice to have their behaviors match but it's not that important. We're happy
   enough if eslint doesn't run out of memory due to issues with the import plugin.
   */

import { buildStrictConfig } from './whtree/jssdk/eslint-config/eslint.config.mjs';

const whtreeConfig = buildStrictConfig({ tsconfigRootDir: "whtree" });

function mapPaths(configArray) {
  for (const item of configArray) {
    if (!item.ignores)
      continue;

    item.ignores.forEach((path, idx) => {
      if (!path.startsWith("*"))
        item.ignores[idx] = "whtree/" + path;
    });
  }
  return configArray;
}

export default mapPaths(whtreeConfig);
