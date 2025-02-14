/* Generate the JavaScript/TypeScript infrastructure */

import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { backendConfig } from "../configuration";
import * as path from "node:path";
import { mkdir, readlink, rm, symlink } from "node:fs/promises";
import { whconstant_builtinmodules } from "../webhareconstants";

type DataRootItem = {
  name: string;
  type: "symboliclink";
  target: string;
} | {
  name: string;
  type: "directory";
  items: DataRootItem[];
};

function getDataRootNodeModules(): DataRootItem[] {
  const installationroot = backendConfig.installationroot;
  const whdataroot = backendConfig.dataroot;
  const storageroot = `${backendConfig.dataroot}storage`;

  const items: DataRootItem[] = Object.entries(backendConfig.module).
    flatMap(([name, settings]) => [
      {
        name: `@mod-${name}`,
        type: "symboliclink",
        target: settings.root
      }, {
        name: `@storage-${name}`,
        type: "symboliclink",
        target: `${storageroot}/${name}`
      }
    ]);

  items.push(
    {
      name: "dompack",
      type: "symboliclink",
      target: `${backendConfig.module.system.root}js/dompack`
    },
    {
      name: "@types",
      type: "directory",
      items: [
        {
          name: "node",
          type: "symboliclink",
          target: `${installationroot}node_modules/@types/node`
        }
      ]
    },
    {
      name: "@webhare",
      type: "symboliclink",
      target: `${installationroot}jssdk/`
    },
    {
      name: "wh:db",
      type: "symboliclink",
      target: `${whdataroot}storage/system/generated/whdb`
    },
    {
      name: "wh:openapi",
      type: "symboliclink",
      target: `${whdataroot}storage/system/generated/openapi`
    },
    {
      name: "wh:schema",
      type: "symboliclink",
      target: `${whdataroot}storage/system/generated/schema`
    },
    {
      name: "wh:wrd",
      type: "symboliclink",
      target: `${whdataroot}storage/system/generated/wrd`
    }
  );
  return items;
}

async function getTSPaths(items: DataRootItem[], startpath: string): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const item of items) {
    if (item.type === "directory")
      Object.assign(result, await getTSPaths(item.items, `${startpath}${item.name}/`));
    else {
      if ((await listDirectory(item.target, { allowMissing: true, mask: "index.*" })).length) //permit direct links like @webhare/std to work
        result[`${startpath}${item.name}`] = [item.target];
      result[`${startpath}${item.name}/*`] = [path.join(item.target, '*')];
    }
  }
  return result;
}

async function buildTSConfig(node_modules: DataRootItem[]) {
  const tsconfig = {
    extends: backendConfig.installationroot + "tsconfig.json",
    compilerOptions: {
      paths: await getTSPaths(node_modules, ""),
      baseUrl: "."
    },
    exclude: ["**/vendor/**"]
  };
  return tsconfig;
}

function formatTSConfig(config: unknown) {
  return JSON.stringify(config, null, 2) + '\n';
}

export async function generateTSConfigTextForModule(module: string) {
  if (!backendConfig.module[module])
    throw new Error(`Module '${module}' not found`);

  const datarootitems = getDataRootNodeModules();
  return formatTSConfig(await buildTSConfig(datarootitems));
}

async function syncLinks(basepath: string, want: DataRootItem[], clean: boolean) {
  const contents = (await listDirectory(basepath)).map(entry => ({ ...entry, used: false }));
  for (const item of want) {
    const itemPath = basepath + item.name;
    const pos = contents.findIndex(entry => entry.name === item.name);
    if (pos !== -1) {
      const found = contents[pos];
      contents[pos].used = true;
      if (found.type === item.type && (item.type === "directory" || (await readlink(found.fullPath)) === item.target))
        continue;

      if (found.type === "directory")
        await rm(found.fullPath, { recursive: true });
    }

    //If we get here, either the item (no longer) exists *or* it's a symlink we can just overwrite
    if (item.type === "symboliclink") {
      //FIXME should be atomic, we need something like storeDiskFile temporary-rename-overwriting but for symlinks?
      await rm(itemPath, { force: true });
      await symlink(item.target, itemPath);
    } else {
      await mkdir(itemPath);
    }
  }

  if (clean) {
    for (const rec of contents)
      if (!rec.used)
        await rm(rec.fullPath, { recursive: rec.type === "directory" });
  }
}


/** Update the symlinks for the rest of the TS/JS system */
export async function updateTypeScriptInfrastructure({ verbose = false } = {}) {
  if (verbose)
    console.time("Updating TypeScript infrastructure");

  async function updateFile(filePath: string, text: string) {
    const { skipped } = await storeDiskFile(filePath, text, { overwrite: true, onlyIfChanged: true });
    if (verbose)
      console.log(`${skipped ? 'Kept' : 'Updated'} file ${filePath}`);
  }

  const whdatamods = backendConfig.dataroot + "node_modules/";
  await mkdir(whdatamods, { recursive: true });

  await updateFile(backendConfig.dataroot + "eslint.config.mjs",
    `import { moduleConfig } from "@webhare/eslint-config";
export default moduleConfig;
`);

  /* When runnning `npm install` in the dataroot or a subdirectory (without its own package.json),
     npm will use the node_modules in the dataroot to place the new packages. It will then happily
     remove all symlinks starting in node_modules, and also and destroy the whole contents of the linked
     directories when the link starts with '@'.
     With the following engine restrictions and setting engine-strict to true, we prevent npm from running at all.
  */
  await updateFile(backendConfig.dataroot + "package.json", JSON.stringify({
    engines: {
      npm: "not-allowed",
      yarn: "not-allowed",
      node: "not-allowed"
    }
  }, null, 2) + '\n');

  await updateFile(backendConfig.dataroot + ".npmrc", `engine-strict=true\n`);

  const datarootitems = getDataRootNodeModules();
  await syncLinks(whdatamods, datarootitems, true); //Add verbose support to syncLinks? but it's a lot of noise

  const tsconfig = await buildTSConfig(datarootitems);
  const dataRootConfig = structuredClone(tsconfig);
  await updateFile(backendConfig.dataroot + "tsconfig.json", JSON.stringify(dataRootConfig, null, 2));

  /* Generate tsconfig.jsons for all modules. Considered going without tsconfig.jsons on non-dev setups but
     - this breaks ESLint validation whose TSLint plugins look up tsconfig.json. we'd have to manually set up those plugins then
     - this breaks loadType in @webhare/tests,it would have to start depending on gen_typescript
     - esbuild might also use it ?

    Note that 'wh checkmodule' currently also updates this for the checked module.*/
  const tsconfigText = formatTSConfig(tsconfig);
  for (const [module, config] of Object.entries(backendConfig.module)) {
    if (!whconstant_builtinmodules.includes(module)) { //the builtin ones are handled by a central tsconfig.json
      await updateFile(config.root + "tsconfig.json", tsconfigText);
    }
  }

  if (verbose)
    console.timeEnd("Updating TypeScript infrastructure");
}
