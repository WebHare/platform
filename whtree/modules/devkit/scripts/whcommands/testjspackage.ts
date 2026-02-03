import { createModule } from "@mod-devkit/js/scaffolding/module";
import { run } from "@webhare/cli";
import { backendConfig } from "@webhare/services";
import { storeDiskFile } from "@webhare/system-tools";
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

/* Short external package requirements unti we've stabilized this
   - must have a package.json in the root
   - must have a testinfo.xml in the root
*/

run({
  description: "Test an externally managed JS package",
  arguments: [{ name: "<package>", description: "Path to package" }],
  main: async ({ opts, args }) => {

    if (!backendConfig.module["jspackagetest"])
      await createModule("", "jspackagetest", { initGit: false, defaultLanguage: "en" });

    //clean up the package path
    let packagepath = path.resolve(args.package);
    if (!existsSync(path.join(packagepath, "package.json")))
      throw new Error("Not a valid package path");
    if (packagepath.endsWith("/"))
      packagepath = packagepath.slice(0, -1);

    //delete any existing package
    const moduleroot = backendConfig.module["jspackagetest"].root;
    if (!moduleroot)
      throw new Error("Module not created ?");

    //symlink the package to test
    await storeDiskFile(moduleroot + "/tests/testinfo.xml", `<group xmlns="http://www.webhare.net/xmlns/system/testinfo">
  <test path="package/" />
</group>
`, { overwrite: true, mkdir: true });

    const testpackage = moduleroot + "/tests/package";
    try {
      unlinkSync(testpackage);
    } catch (e) { //ignore 'doesnt exist' errors
      if ((e as { code?: string })?.code !== "ENOENT")
        throw e;
    }
    symlinkSync(packagepath, testpackage);

    //run the tests
    spawnSync("wh", ["runtest", "jspackagetest"], { stdio: "inherit" });
  }
});
