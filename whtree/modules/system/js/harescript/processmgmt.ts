import { backendConfig } from "@webhare/services";
import { spawnSync } from "child_process";

export async function launchScriptWithRun(scriptname: string, args: string[]) {
  const proc = spawnSync(backendConfig.installationRoot + "/bin/wh", ["run", scriptname, ...args], { encoding: "utf-8", stdio: ['ignore', 'pipe', 1] });
  return { error: proc.status !== 0, output: (proc.stdout || "\nScript returned exit code " + proc.status).trim() };
}
