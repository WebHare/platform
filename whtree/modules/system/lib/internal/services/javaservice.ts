import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export async function runJavaServiceApp(jar_and_args: string[]): Promise<{ cmdline: string; output: string; exitcode: number }> {
  const app = [
    '/opt/homebrew/opt/openjdk/bin/java', //Homebrew macOS on arm
    '/usr/local/opt/openjdk/bin/java', //Homebrew macOs on x86
    '/usr/local/bin/java',
    '/usr/bin/java',
  ].find(_ => existsSync(_));
  if (!app)
    throw new Error("No Java executable found");

  const args = ["-jar", ...jar_and_args];
  const output = spawnSync(app, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return {
    cmdline: args.join(" "),
    output: output.stdout,
    exitcode: output.status ?? 0,
  };
}
