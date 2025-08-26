/* The platform JSSDK packages are either published as a group together to npmjs (using publish_jssdk)
   or don't make sense outside WebHare at all

   Note that not all @webhare/ packages on npmjs are part of the platform JSSDK

   wh run mod::platform/scripts/jspackages/validate_jssdk.ts
   wh run mod::platform/scripts/jspackages/validate_jssdk.ts --fix
*/

import { run } from "@webhare/cli";
import { backendConfig } from "@webhare/services";
import { readFile, writeFile } from "fs/promises";
import { join } from 'path';
import { existsSync } from 'fs';
import { readAxioms } from '@mod-platform/js/configure/axioms';
import { listDirectory } from '@webhare/system-tools';
import type { PackageJson } from "../../js/devsupport/jspackages";

run({
  description: "Validate/lint the WebHaer JSSDK packages",
  flags: {
    "v,verbose": { description: "Verbose log level" },
    "fix": { description: "Attempt automated fixes" },
  },
  main: async ({ opts }) => {
    const axioms = await readAxioms();
    let anyIssues = false;

    for (const pkg of await listDirectory(backendConfig.installationRoot + "/jssdk")) {
      const issues: Array<{
        message: string;
        toFix?: () => void;
      }> = [];

      if (pkg.type !== "directory")
        continue;

      if (opts.verbose)
        console.log(`Checking ${pkg.name}`);


      const pkgjson = JSON.parse(await readFile(join(pkg.fullPath, "package.json"), "utf8")) as PackageJson;
      if (pkgjson.version !== "") //you can't remove it, npm will put it back
        issues.push({ message: "Version should be empty", toFix: () => pkgjson.version = "" });
      if (pkgjson.private !== true)
        issues.push({ message: "Private should be 'true' to prevent accidental manual publishes", toFix: () => pkgjson.private = true });
      if (pkgjson.name !== `@webhare/${pkg.name}`)
        issues.push({ message: "Package name mismatch", toFix: () => pkgjson.name = `@webhare/${pkg.name}` });
      if (pkgjson.main && !pkgjson.main.endsWith(".mjs")) { //ignore non-typescript packages for these checks
        if (pkgjson.main !== `src/${pkg.name}.ts`) //Eg @webhare/rpc must use src/rpc.ts (and not rpc-clinet.ts)
          issues.push({ message: "Package main entry mismatch", toFix: () => pkgjson.main = `src/${pkg.name}.ts` });
        if (pkgjson.typedocOptions?.entryPoints?.length !== 1 || pkgjson.typedocOptions?.entryPoints[0] !== `./src/${pkg.name}.ts`) {
          issues.push({
            message: "typedoc entrypoint mismatch", toFix: () => {
              pkgjson.typedocOptions ||= {};
              pkgjson.typedocOptions.entryPoints = [`./src/${pkg.name}.ts`];
            }

          });
        }
      }

      for (const [dep, version] of Object.entries(pkgjson.dependencies || []))
        if (dep.startsWith("@webhare/") && version)
          issues.push({ message: `Dependency on peer package '${dep}' should not specify an explicit version`, toFix: () => pkgjson.dependencies![dep] = "" });

      for (const forbiddenfield of axioms.copyPackageFields)
        if (forbiddenfield in pkgjson)
          issues.push({ message: `Field '${forbiddenfield}' is maintained centrally, not per package`, toFix: () => delete (pkgjson as Record<string, unknown>)[forbiddenfield] });

      if (axioms.publishPackages.includes(pkg.name)) { //this package will be published
        if (!existsSync(join(pkg.fullPath, "README.md")))
          issues.push({ message: `Package has no README.md` });
        if (!pkgjson.description)
          issues.push({ message: `Package has no description in package.json` });
      }

      if (pkgjson.main?.endsWith(".ts")) {
        //Verify @declare module fragment presence. It's still far from perfect but helps TypeScript language server to hint to better imports
        const tsfile = await readFile(join(pkg.fullPath, pkgjson.main), "utf8");
        const expfragment = `declare module "@webhare/${pkg.name}"`;
        if (!tsfile.includes(expfragment))
          issues.push({ message: `Missing the '${expfragment}' declaration in ${join(pkg.fullPath, pkgjson.main)}` });
      }

      if (issues.length) {
        anyIssues = true;
        if (!opts.fix || issues.find(_ => !_.toFix)) {
          for (const issue of issues)
            console.log(`- @webhare/${pkg.name}: ${issue.message}`);
        } else { //fix them!
          for (const issue of issues) {
            console.log(`- @webhare/${pkg.name}: ${issue.message} (fixing)`);
            issue.toFix!();
          }
          await writeFile(join(pkg.fullPath, "package.json"), JSON.stringify(pkgjson, null, 2) + "\n");
        }
      }
    }

    const globalissues = [];

    if (!existsSync(backendConfig.installationRoot + "node_modules/esbuild/bin/esbuild"))
      globalissues.push("esbuild is not installed in our root");
    else if (existsSync(backendConfig.installationRoot + "jssdk/tsrun/node_modules/esbuild/bin/esbuild"))
      globalissues.push("tsrun has its own esbuild but there should be only one version around");

    if (globalissues.length) {
      anyIssues = true;
      for (const issue of globalissues)
        console.log(`- ${issue}`);
    }

    if (anyIssues && !opts.fix) { //issues!
      process.exitCode = 1;
      console.log('Run `wh run mod::platform/scripts/jspackages/validate_jssdk.ts --fix` to attempt automatic fixes');
    }
  }
});
