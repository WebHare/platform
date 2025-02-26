import { backendConfig } from "@webhare/services";
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fixJSPackages, type PackageJson } from "@mod-platform/scripts/jspackages/jspackages";
import { simpleGit } from "simple-git";

interface PackageRef {
  type: "git";
  url: string;
  name: string;
}

export function parsePackageRef(ref: string): PackageRef | null {
  //parse git:repository url/(package name).git
  const parsedAsGit = ref.match(/^git.*\/([^/]+)\.git$/);
  if (parsedAsGit) {
    return {
      type: "git",
      url: ref,
      name: parsedAsGit[1]
    };
  }
  return null;
}

export async function addPackage(module: string, parsed: PackageRef, options?: {
  at?: string;
  force?: boolean;
}) {
  const modroot = backendConfig.module[module]?.root;
  if (!modroot)
    throw new Error(`Module '${module}' does not exist`);

  const parentLocation = path.join(modroot, options?.at || 'vendor');
  const finalLocation = path.join(parentLocation, parsed.name);
  if (existsSync(finalLocation)) {
    try {  //Try to delete first. If that works, it was empty and we ignore the error
      rmdirSync(finalLocation);
    } catch (e) {
      throw new Error(`Directory ${finalLocation} already exists`);
    }
  }

  //Determine repo url
  let repourl = parsed.url;
  const origin = (await simpleGit({ baseDir: modroot }).getRemotes(true)).find(_ => _.name === "origin");
  if (origin?.refs.fetch) {
    //split into server and path
    const fetchOrigin = origin?.refs.fetch.match(/^(.*):(.*)$/);
    const repoOrigin = repourl.match(/^(.*):(.*)$/);
    if (fetchOrigin && repoOrigin && fetchOrigin[1] === repoOrigin[1]) { //same server..
      /* Using relative URLs works a lot better with CI, eg gitlab CI allows us to more easily
         reuse the credentials from the main module */
      console.log("Replacing origin with relative path: ");
      repourl = path.relative(fetchOrigin[2], repoOrigin[2]);
    }
  }

  //Prepare to add it as a workspace
  const modulePackageJson = modroot + "package.json";
  const packageJson = JSON.parse(readFileSync(modulePackageJson, "utf8")) as PackageJson;

  if (!packageJson.workspaces)
    packageJson.workspaces ||= [];
  const addpath = path.relative(modroot, finalLocation);
  const updatePackageJson = !packageJson.workspaces.includes(addpath);
  if (updatePackageJson)
    packageJson.workspaces.push(addpath);

  //Clone as submodule
  console.log(`Cloning ${parsed.name} as submodule into ${finalLocation}`);
  const installArgs = ["add", ...(options?.force ? ["--force"] : []), repourl, path.relative(modroot, finalLocation)];
  mkdirSync(parentLocation, { recursive: true });
  await simpleGit({ baseDir: modroot }).subModule(installArgs);

  //Update package json
  console.log(`Adding as workspace and adding necessary packages`);
  if (updatePackageJson)
    writeFileSync(modulePackageJson, JSON.stringify(packageJson, null, 2) + "\n");
  await fixJSPackages(module);
}
