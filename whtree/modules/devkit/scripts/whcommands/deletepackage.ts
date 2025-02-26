import * as path from "node:path";
import { CLIRuntimeError, run } from "@webhare/cli";
import { existsSync, readFileSync } from "node:fs";
import { simpleGit } from "simple-git";
import { isTruthy } from "@webhare/std";
import { backendConfig, parseResourcePath, toResourcePath } from "@webhare/services";
import { fixJSPackages, type PackageJson } from "@mod-platform/scripts/jspackages/jspackages";
import { storeDiskFile } from "@webhare/system-tools";

run({
  description: "Delete a package from a module",
  flags: {
    "f,force": { description: "Force deletion" },
  },
  options: {
    "at": { default: "/vendor/", description: "Location to install the package." },
  },
  arguments: [{ name: "<path>", description: "Path to the package to delete" }],
  main: async ({ opts, args }) => {
    const todelete = path.resolve(args.path);
    if (!existsSync(todelete))
      throw new CLIRuntimeError(`Path ${todelete} does not exist`);

    const asModulePath = parseResourcePath(toResourcePath(todelete));
    if (!asModulePath?.module)
      throw new CLIRuntimeError(`Path ${todelete} is not in a module`);

    let findPath = asModulePath.subpath;
    if (findPath.endsWith("/"))
      findPath = findPath.slice(0, -1);

    const modroot = backendConfig.module[asModulePath.module].root;

    const modulePackageJson = modroot + "package.json";
    const packageJson = JSON.parse(readFileSync(modulePackageJson, "utf8")) as PackageJson;

    if (packageJson.workspaces?.includes(findPath)) {
      //remove it from the package json
      console.log(`Removing submodule ${findPath} from workspaces`);
      packageJson.workspaces = packageJson.workspaces.filter(_ => _ !== findPath);
      await storeDiskFile(modulePackageJson, JSON.stringify(packageJson, null, 2) + "\n", { overwrite: true });
    }

    //Parse lines of this form:  88184999d5c4064e37f0b687d0180ea48407e7b1 vendor/psp-pay.nl (heads/main)
    const submodules = (await simpleGit({ baseDir: modroot }).subModule()).split('\n').map(line => line.match(/^ *[-0-9a-f]+ ([^ ]+) \((.*)\)$/)).filter(isTruthy);
    const match = submodules.find(_ => _[1] === findPath);
    if (!match) {
      throw new CLIRuntimeError(`Path ${todelete} is not a submodule - valid submodules are: ${submodules.map(_ => _[1]).join(", ")}`);
    }

    console.log(`Deleting submodule ${findPath}`);
    await simpleGit({ baseDir: modroot }).subModule(["deinit", ...(opts.force ? ["--force"] : []), findPath]);

    console.log(`Updating node_modules`);
    await fixJSPackages(asModulePath.module);
  }
});
