import { spawnSync } from "child_process";

/** The TS helper for HS spawnProcessSync, hence the name. It's async but will be made sync in HareScript */
export async function spawnProcessSync(cmd: string, args: string[]) {
  const proc = spawnSync(cmd, args, { encoding: "utf-8", stdio: ['ignore', 'pipe', 1] });
  return {
    error: proc.status !== 0,
    //node 24 lacks convertProcessSignalToExitCode so we'll just map signals to -1
    exitcode: proc.status ?? -1,
    output: proc.stdout
  };
}
