import { backendConfig } from "@webhare/services/src/config";
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { whconstant_builtinmodules } from '@mod-system/js/internal/webhareconstants';
import { toResourcePath } from '@webhare/services';
import { spawnSync } from 'node:child_process';
import { storeDiskFile } from '@webhare/system-tools';
import { run } from '@webhare/cli';


function getPackageDirs(module: string): string[] {
  const pkgdirs = [];
  if (module === "platform") {
    //include whtree/
    pkgdirs.push(backendConfig.installationRoot);
    //include builtin modules
    for (const mod of whconstant_builtinmodules)
      if (mod !== module) //prevent loop
        pkgdirs.push(...getPackageDirs(mod));
  }

  const modroot = backendConfig.module[module]?.root;
  if (!modroot)
    throw new Error(`Module '${module}' not found`);

  if (existsSync(join(modroot, "package.json")))
    pkgdirs.push(modroot);
  if (existsSync(join(modroot, "webdesigns")))
    for (const webdesigndir of readdirSync(join(modroot, "webdesigns")))
      if (existsSync(join(modroot, "webdesigns", webdesigndir, "package.json")))
        pkgdirs.push(join(modroot, "webdesigns", webdesigndir));

  return pkgdirs;

}

export interface ModuleAuditFormat {
  module: string;
  generated: string;
  errors: Array<{
    message: string;
    resource: string;
  }>;
  packageDirs: Array<{
    dir: string; //reported dir, in resource format where possible
    npmAudit: unknown; //probably typed in https://github.com/DefinitelyTyped/DefinitelyTyped/blob/b8d1466d9111780dca384f9d79ac7f8c696efc01/types/npmcli__arborist/index.d.ts#L298
    directDependencies: Record<string, string>;
  }>;

}

run({
  options: {
    "outputfile": { description: "output file" },
  },
  arguments: [
    {
      name: "<module>", description: "module to audit"
    }
  ],
  async main({ opts, args }) {
    const module = args.module;
    const retval: ModuleAuditFormat = {
      module,
      generated: new Date().toISOString(),
      errors: [],
      packageDirs: []
    };

    const pkgdirs = getPackageDirs(module);
    for (const dir of pkgdirs) {
      const reportDir = toResourcePath(dir, { keepUnmatched: true });
      const directDependencies = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies || {}) as Record<string, string>;
      if (!Object.keys(directDependencies).length)
        continue; //no need to mention this dir, no modules

      const auditResult = spawnSync("npm", ["audit", "--json"], { cwd: dir });
      const output = auditResult.stdout.toString().trim();
      if (!output) {
        retval.errors.push({
          message: (`npm audit failed: ${auditResult.status ?? auditResult.signal}\n` + output).trim(),
          resource: reportDir
        });
        continue;
      }

      try {
        retval.packageDirs.push({ dir: reportDir, npmAudit: JSON.parse(output), directDependencies });
      } catch (e) {
        retval.errors.push({
          message: (`npm audit failed: ${e}`).trim(),
          resource: reportDir
        });
      }
    }

    if (opts.outputfile)
      await storeDiskFile(opts.outputfile, JSON.stringify(retval), { overwrite: true });
    else
      console.log(JSON.stringify(retval, null, 2));
  }
});
