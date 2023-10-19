import { existsSync, readdirSync } from "fs";
import { join } from "node:path";
import { execFile } from 'node:child_process';
import { promisify } from "node:util";

function listNodePackageRoots(basepath: string) {
  const webdesigndirs = [];
  try {
    webdesigndirs.push(...readdirSync(join(basepath, "webdesigns")).map((x) => join(basepath, "webdesigns", x)));
  } catch (ignore) { //the webdesigns subfolder probably doesnt exist itself
  }

  const trypaths = [basepath, ...webdesigndirs];
  return trypaths.filter(x => existsSync(join(x, "package.json")));
}

/* ==============
   this is an experiment to speed up the npm ls calls. it's a proof of concept, it's leaky etc.
   test it by enabling it and invoking: wh run mod::system/scripts/internal/listbrokenmodules.whscr
   */
async function buildMyNpm() {
  //@ts-ignore experimental, ignore
  const Npm = (await import("/usr/local/lib/node_modules/npm/lib/npm.js")).default;

  class MyNpm extends Npm {
    __npmOutput = "";

    constructor(...args: unknown[]) {
      super(...args);
    }

    outputBuffer(data: string) {
      this.__npmOutput += data;
    }
  }

  return MyNpm;
}
let buildMyNpmPromise: ReturnType<typeof buildMyNpm> | undefined;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only enabled when experimenting
async function listNPMIssues_Experimental(path: string) {
  if (!buildMyNpmPromise)
    buildMyNpmPromise = buildMyNpm();

  process.argv = [];
  const npm = new (await buildMyNpmPromise)({ argv: ["--json", "--prefix", path] });
  await npm.load();
  await npm.exec("ls");

  try {
    const res = JSON.parse(npm.__npmOutput) as {
      problems?: string[];
    };
    return res?.problems?.map(error => ({ basepath: path, error })) ?? [];
  } catch (e) {
    return [{ basepath: path, error: "Exception validating packags: " + (e as Error)?.message }];
  }
}

/* Experiment ends here
   ==============
   */


async function listNPMIssues(path: string) {
  // return listNPMIssues_Experimental(path);

  const { stdout/*, stderr*/ } = await promisify(execFile)("npm",
    ["ls", "--json", "--prefix", path],
    { timeout: 15000, killSignal: "SIGKILL" }
  ).then(e => e, e => e); //convert catch back to a normal result (happens on exitcode 1)

  try {
    const res = JSON.parse(stdout) as {
      problems?: string[];
    };
    return res?.problems?.map(error => ({ basepath: path, error })) ?? [];
  } catch (e) {
    return [{ basepath: path, error: "Exception validating packags: " + (e as Error)?.message }];
  }

}

export async function checkNodeModulesInModule(modulerootdir: string) {
  const issues = [];
  for (const checkresult of await Promise.all(listNodePackageRoots(modulerootdir).map(listNPMIssues)))
    issues.push(...checkresult);
  return issues;
}

// checkNodeModulesInModule("/Users/arnold/projects/webhare/whtree/modules/webhare_testsuite")
