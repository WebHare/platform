import { spawnSync } from "child_process";
import { convertProcessSignalToExitCode } from "util";

/** The TS helper for HS spawnProcessSync, hence the name. It's async but will be made sync in HareScript */
export async function spawnProcessSync(cmd: string, args: string[]) {
  const proc = spawnSync(cmd, args, { encoding: "utf-8", stdio: ['ignore', 'pipe', 1] });
  return {
    error: proc.status !== 0,
    //nodejs offsets signals by 128, but WebHare used to offset by 256, so just add another 128
    exitcode: proc.status ?? (128 + convertProcessSignalToExitCode(proc.signal!)),
    output: proc.stdout
  };
}
