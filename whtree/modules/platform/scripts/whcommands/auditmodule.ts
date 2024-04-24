import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { backendConfig } from "@webhare/services/src/config";
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { whconstant_builtinmodules } from '@mod-system/js/internal/webhareconstants';
import { toResourcePath } from '@webhare/services';
import { spawnSync } from 'node:child_process';
import { storeDiskFile } from '@webhare/system-tools';

program.name("platform:auditmodule")
  .option("--outputfile <path>", "output file")
  .argument("<module>", "module to audit")
  .parse();

function getPackageDirs(module: string): string[] {
  const pkgdirs = [];
  if (module === "platform") {
    //include whtree/
    pkgdirs.push(backendConfig.installationroot);
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

async function main() {
  const module = program.args[0];
  const retval: ModuleAuditFormat = {
    module,
    generated: new Date().toISOString(),
    errors: [],
    packageDirs: []
  };

  const pkgdirs = getPackageDirs(module);
  for (const dir of pkgdirs) {
    const reportDir = toResourcePath(dir, { allowUnmatched: true }) ?? dir;
    const auditResult = spawnSync("npm", ["audit", "--json"], { cwd: dir });
    let npmAudit: unknown = null;
    if (auditResult.status !== 0)
      retval.errors.push({
        message: `npm audit failed: ${auditResult.status ?? auditResult.signal}`,
        resource: reportDir
      });
    else {
      npmAudit = JSON.parse(auditResult.stdout.toString());
    }

    const directDependencies = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies || {}) as Record<string, string>;
    retval.packageDirs.push({ dir: reportDir, npmAudit, directDependencies });
  }

  if (program.opts().outputfile)
    await storeDiskFile(program.opts().outputfile, JSON.stringify(retval), { overwrite: true });
  else
    console.log(JSON.stringify(retval, null, 2));
}

main();
