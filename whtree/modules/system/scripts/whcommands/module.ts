// syntax: <command>
// @webhare/cli: Manage modules

import { CLIRuntimeError, runCli } from "@webhare/cli";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { readFileSync } from "node:fs";

type ImportResult = {
  importmodulename: string;
  warnings: string[];
  errors: string[];
};

function isAbsoluteURL(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol !== "" && parsed.protocol !== "file:";
  } catch {
    return false;
  }
}

async function getInstallBlob(pathOrUrl: string): Promise<WebHareBlob> {
  if (isAbsoluteURL(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok)
      throw new CLIRuntimeError(`Failed to download from ${pathOrUrl}`);

    return WebHareBlob.from(Buffer.from(await response.arrayBuffer()));
  }

  return WebHareBlob.from(readFileSync(pathOrUrl));
}

async function deleteModule(name: string) {
  await loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule(name);
}

async function installModule(pathOrUrl: string): Promise<void> {
  const toInstall = await getInstallBlob(pathOrUrl);
  const installResult = await loadlib("mod::system/lib/internal/moduleimexport.whlib").ImportModule(toInstall) as ImportResult;

  if (installResult.errors.length > 0)
    throw new CLIRuntimeError("Installation failed:\n" + installResult.errors.join("\n"));

  console.log(`Module '${installResult.importmodulename}' installed`);
  if (installResult.warnings.length > 0)
    console.log("There were warnings:\n" + installResult.warnings.join("\n"));
}

const argv = process.argv.slice(2).map(arg => {
  if (arg === "del" || arg === "delete")
    return "rm";
  return arg;
});

runCli({
  description: "Manage modules",
  subCommands: {
    create: {
      hidden: true,
      description: "Deprecated: use wh devkit:createmodule",
      async main() {
        throw new CLIRuntimeError("`wh module create` is no longer supported - use wh devkit:createmodule");
      }
    },
    createwebdesign: {
      hidden: true,
      description: "Deprecated: use wh dev:createwebdesign",
      async main() {
        throw new CLIRuntimeError("`wh module createwebdesign` is no longer supported - use wh dev:createwebdesign");
      }
    },
    install: {
      description: "Install a module",
      arguments: [
        { name: "<path>", description: "Path or URL to a module archive" },
      ],
      async main({ args }) {
        await installModule(args.path);
      }
    },
    rm: {
      description: "Delete a module",
      arguments: [
        { name: "<modulename>", description: "Module to delete" },
      ],
      async main({ args }) {
        await deleteModule(args.modulename);
      }
    }
  }
}, { argv });
