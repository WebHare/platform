import { backendConfig } from "@webhare/services";
import { spawn } from "node:child_process";

export type PackageJson = {
  version?: string;
  main?: string;
  name?: string;
  description?: string;
  private?: boolean;
  files?: string[];
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
  typedocOptions?: {
    entryPoints?: string[];
  };
};

const npmJSPackageInstallOptions = ["--no-update-notifier", "--quiet", "--no-fund", "--no-audit", "--no-save", "--ignore-scripts", "--no-progress", "--omit=peer", "--omit=dev"];

async function spawnNPM(dir: string, args: string[]) {
  const process = spawn("npm", args, { cwd: dir, stdio: "inherit" });
  return new Promise<void>((resolve, reject) => {
    process.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm exited with code ${code}`));
      }
    });
  });
}

//Install modules like wh fixmodules would (TODO integrate wh fixmodules)
export async function fixJSPackages(module: string) {
  const modroot = backendConfig.module[module]?.root;
  if (!modroot) {
    throw new Error(`Module root not found for module: ${module}`);
  }

  await spawnNPM(modroot, ["install", ...npmJSPackageInstallOptions]);
}
