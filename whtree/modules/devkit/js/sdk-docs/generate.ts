import { backendConfig } from "@webhare/services";
import * as TypeDoc from "typedoc";
import { readJSONFile } from "@mod-platform/js/cli/cli-tools";
import { listDirectory } from "@webhare/system-tools";
import { existsSync } from "node:fs";

/* TODO: we're currently stuck at typedoc 0.26 as 0.27 switch to ESM and we can't actually load that using tsrun
         we also had to override the dependency in our package.json to get 'npm install' to not complain about the incompatible version */

const blacklistModules = [
  //might not want to provide as a separate maintained module in core webhare
  "dompack-overlays"
];

export async function setupDocGenerator() {
  const entryPoints = [];
  for (const pkg of await listDirectory(backendConfig.installationRoot + "jssdk")) {
    if (blacklistModules.includes(pkg.name))
      continue;

    if (!existsSync(pkg.fullPath + "/package.json"))
      continue; //not a package

    const packageinfo = await readJSONFile<{ main?: string }>(pkg.fullPath + "/package.json");

    if (!packageinfo.main?.endsWith('.ts'))
      continue; //not an interesting package (eg. eslint, tsrun)

    entryPoints.push(pkg.fullPath + '/' + packageinfo.main);
  }

  // Application.bootstrap also exists, which will not load plugins
  // Also accepts an array of option readers if you want to disable
  // TypeDoc's tsconfig.json/package.json/typedoc.json option readers
  const app = await TypeDoc.Application.bootstrapWithPlugins({
    "entryPoints": entryPoints,
    "tsconfig": backendConfig.installationRoot + "tsconfig.json",
    "name": "WebHare Platform SDK",
    // "entryPointStrategy": "packages",
    "includeVersion": true,
    "excludeExternals": true,
    githubPages: false,
    hideGenerator: true,
  });

  return app;
}
