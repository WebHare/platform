import { spawnSync } from "child_process";

export async function spawnProcessSync(cmd: string, args: string[]) {
  const proc = spawnSync(cmd, args, { encoding: "utf-8", stdio: ['ignore', 'pipe', 1] });
  return { error: proc.status !== 0, output: (proc.stdout || "\nScript returned exit code " + proc.status).trim() };
}
