/*
wh run mod::platform/scripts/platformdev/package_jssdk.ts
*/

import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { backendConfig } from "@webhare/services";
import { StdioOptions, spawnSync } from "child_process";
import { cp, mkdir, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { pick } from '@webhare/std';
import YAML from "yaml";

program.name("package_jssdk")
  .option("-v, --verbose", "verbose log level")
  .option("--publish-alpha", "publish alpha packages")
  .option("--publish-prod", "publish production packages")
  .parse();

const verbose: boolean = program.opts().verbose;
const publishAlpha: boolean = program.opts().publishAlpha;
const publishProd: boolean = program.opts().publishProd;
const publish = publishAlpha || publishProd;
const stdio: StdioOptions = verbose ? ["ignore", "inherit", "inherit"] : ["ignore", "ignore", "ignore"];

if (publishProd)
  throw new Error("Not implemented yet");
if (publishProd && publishAlpha)
  throw new Error("Use either --publish-prod or --publish-alpha but not both");

async function main() {
  const workdir = join(backendConfig.dataroot, "tmp", "package_jssdk");
  if (verbose)
    console.log(`Work dir: ${workdir}`);
  const [majorText, minorText] = backendConfig.buildinfo.version.split(".");
  const major = parseInt(majorText);
  const minor = parseInt(minorText);
  if (!major || isNaN(minor) || minor >= 100)
    throw new Error("Invalid version number");

  const versionbase = `0.${major * 100 + minor}`;
  const version = `${versionbase}.0`; //TODO bump until we find a free number
  const isotime = (new Date().toISOString()).replaceAll(/[^0-9]/g, '');
  const versionfinal = `${version}-alpha-${isotime.substring(0, 8)}-${isotime.substring(8, 14)}`;
  if (verbose)
    console.log("Version", versionfinal);

  // Build the esbuild-runner first. Also: keep this list in dependency order
  const packages = YAML.parse(await readFile(backendConfig.module.platform.root + "data/axioms.yml", 'utf8')).publishPackages;

  // Throw the packages in place
  const jssdkPath = join(workdir, "jssdk");
  await rm(jssdkPath, { recursive: true, force: true });
  await mkdir(jssdkPath, { recursive: true });

  for (const pkgname of packages) {
    const destdir = join(jssdkPath, pkgname);
    if (verbose)
      console.log("Writing", destdir);

    //Make a copy but remove any lingering files in dist/
    await cp(join(backendConfig.installationroot, 'jssdk', pkgname), destdir, { recursive: true });
    await rm(join(destdir, 'dist'), { recursive: true, force: true });
  }

  const rootpackagejson = JSON.parse(await readFile(join(backendConfig.installationroot, "package.json"), "utf8"));
  const fixedsettings = pick(rootpackagejson, ["author", "license"]);

  //let's patch the packages for distribution outside the WebHare tree
  for (const pkgname of packages) {
    const pkgroot = join(jssdkPath, pkgname);
    const packagejson = JSON.parse(await readFile(join(pkgroot, "package.json"), "utf8"));
    packagejson.private = false;
    packagejson.files = ["dist/", "bin/"];
    Object.assign(packagejson, fixedsettings);

    const src = packagejson.main;
    if (src) {
      //Do not extend from whtree/tsconfig.json - we'll pick up all the paths and not properly keep dependencies external
      await writeFile(join(pkgroot, "tsconfig.json"), JSON.stringify({
        include: [src],
        compilerOptions: {
          target: "es2022",
          noEmit: false,
          declaration: true,
          module: "commonjs",
          typeRoots: [join(backendConfig.installationroot, "node_modules/@types")]
        }
      }, null, 2), "utf8");

      /* NOTE
           add --showConfig to dump final configuration
           add --traceResolution to debug import lookups
      */
      const result = spawnSync(join(backendConfig.installationroot, "node_modules/.bin/tsc"), ["--outDir", "dist/"], { cwd: pkgroot, stdio });
      if (result.status)
        throw new Error(`Failed to compile ${pkgname} (use --verbose for more info)`);

      packagejson.main = "dist/" + pkgname + ".js";
    }

    packagejson.version = versionfinal;
    await writeFile(join(pkgroot, "package.json"), JSON.stringify(packagejson, null, 2) + '\n', "utf8");

    //Install it
    const installResult = spawnSync("npm", ["install", "--omit=dev"], { cwd: pkgroot, stdio });
    if (installResult.status)
      throw new Error(`Failed to pack ${pkgname} (use --verbose for more info)`);
  }

  let accesstoken = '';
  if (publish) {
    accesstoken = process.env.WEBHARE_JSSDK_PUBLISHTOKEN || '';
    if (!accesstoken)
      throw new Error(`WEBHARE_JSSDK_PUBLISHTOKEN must be set to an Automation token with publish rights`);
  }

  for (const pkgname of packages) {
    const pkgroot = join(jssdkPath, pkgname);

    if (publish) {
      //Publish it
      const tag = publishAlpha ? "alpha" : "latest";
      const publishResult = spawnSync("npm", ["publish", "--tag=" + tag, "--access=public", `--//registry.npmjs.org/:_authToken=${accesstoken}`], {
        cwd: pkgroot,
        stdio,
      });

      if (publishResult.status) {
        //the granular tokens don't support automation
        console.error("If you need to create a new token, visit https://www.npmjs.com/, tap profile icon, Access Tokens > Generate New Token > Classic > Automation");
        throw new Error(`Failed to publish ${pkgname} (use --verbose for more info)`);
      }

      // const fetchinfo = await fetch(`https://registry.npmjs.org/${encodeURIComponent(`@webhare/${pkgname}`)}`);
      // const pkginfo = await fetchinfo.json();

      /*
      // for now, any publish will attempt to remove all existing Alphas
          Unfortunately this doesn't actually work with automation, so I guess we'll just not bother until we have a way to do this
      for (const [versionnr,] of Object.entries(pkginfo.versions)) {
        if (versionnr.includes("alpha") && versionnr !== versionfinal) {
          //Unpublish it.
          /*
          const unpublishResult = spawnSync("npm", ["unpublish", `--//registry.npmjs.org/:_authToken=${accesstoken}`, `@webhare/${pkgname}@${versionnr}`], { cwd: pkgroot, stdio });
          if (unpublishResult.status)
            throw new Error(`Failed to unpublish ${pkgname} (use --verbose for more info)`);

        }
      }*/
    } else {
      //Pack it
      const packResult = spawnSync("npm", ["pack", "--foreground-scripts", "--pack-destination", join(workdir, "jssdk")], { cwd: pkgroot, stdio });
      if (packResult.status)
        throw new Error(`Failed to pack ${pkgname} (use --verbose for more info)`);
    }
  }
}

main();
