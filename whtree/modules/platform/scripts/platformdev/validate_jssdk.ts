/* The platform JSSDK packages are either published as a group together to npmjs (using package_jssdk)
   or don't make sense outside WebHare at all

   Note that not all @webhare/ packages on npmjs are part of the platform JSSDK

   wh run mod::platform/scripts/platformdev/validate_jssdk.ts
   wh run mod::platform/scripts/platformdev/validate_jssdk.ts --fix
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { backendConfig } from "@webhare/services/src/config";
import { readFile, readdir, writeFile } from "fs/promises";
import { join } from 'path';
import { existsSync } from 'fs';
import { readAxioms } from '@mod-platform/js/configure/axioms';

program.name("package_jssdk")
  .option("-v, --verbose", "verbose log level")
  .option("--fix", "autofix issues")
  .parse();

const verbose: boolean = program.opts().verbose;
const fix: boolean = program.opts().fix;

async function main() {
  const axioms = await readAxioms();

  for (const pkg of await readdir(backendConfig.installationroot + "/jssdk", { withFileTypes: true })) {
    if (!pkg.isDirectory())
      continue;

    if (verbose)
      console.log(`Checking ${pkg.name}`);

    const issues: Array<{
      message: string;
      toFix?: () => void;
    }> = [];

    const pkgroot = join(backendConfig.installationroot, 'jssdk', pkg.name);
    const pkgjson = JSON.parse(await readFile(join(pkgroot, "package.json"), "utf8"));
    if (pkgjson.version !== "") //you can't remove it, npm will put it back
      issues.push({ message: "Version should be empty", toFix: () => pkgjson.version = "" });
    if (pkgjson.private !== true)
      issues.push({ message: "Private should be 'true' to prevent accidental manual publishes", toFix: () => pkgjson.private = true });
    if (pkgjson.name !== `@webhare/${pkg.name}`)
      issues.push({ message: "Package name mismatch" });
    for (const [dep, version] of Object.entries(pkgjson.dependencies || []))
      if (dep.startsWith("@webhare/") && version)
        issues.push({ message: `Dependency on peer package '${dep}' should not specify an explicit version`, toFix: () => pkgjson.dependencies[dep] = "" });

    for (const forbiddenfield of axioms.copyPackageFields)
      if (forbiddenfield in pkgjson)
        issues.push({ message: `Field '${forbiddenfield}' is maintained centrally, not per package`, toFix: () => delete pkgjson[forbiddenfield] });

    if (axioms.publishPackages.includes(pkg.name)) { //this package will be published
      if (!existsSync(join(pkgroot, "README.md")))
        issues.push({ message: `Package has no README.md` });
      if (!pkgjson.description)
        issues.push({ message: `Package has no description in package.json` });
    }

    if (issues.length) {
      if (!fix || issues.find(_ => !_.toFix)) {
        process.exitCode = 1;
        for (const issue of issues)
          console.log(`- @webhare/${pkg.name}: ${issue.message}`);
      } else { //fix them!
        for (const issue of issues) {
          console.log(`- @webhare/${pkg.name}: ${issue.message} (fixing)`);
          issue.toFix!();
        }
        await writeFile(join(pkgroot, "package.json"), JSON.stringify(pkgjson, null, 2) + "\n");
      }
    }

  }
  if (process.exitCode && !fix) //issues!
    console.log('Run `wh run mod::platform/scripts/platformdev/validate_jssdk.ts --fix` to attempt automatic fixes');
}

main();
