// @webhare/cli: allowautocomplete
// short: Convert a module's *.es files to TypeScript (disabling any linting/checking)

import { CLIRuntimeError, run } from "@webhare/cli";
import { backendConfig, toResourcePath } from "@webhare/services";
import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { readFile, rename, rm } from "fs/promises";
import { prepTSHost } from "@webhare//test/src/testsupport";
import { generateTSConfigTextForModule } from "@mod-system/js/internal/generation/gen_typescript";
import ts from "typescript/lib/typescript";
import { handleLintingCommand } from "@mod-system/js/internal/eslint";
import { simpleGit } from "simple-git";

function containsJSX(node: ts.Node): true | undefined {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
    return true;

  return ts.forEachChild(node, containsJSX);
}

run({
  arguments: [{ name: "<module>", description: "Module to convert" }],
  async main({ args }) {
    const root = backendConfig.module[args.module]?.root;
    if (!root)
      throw new CLIRuntimeError(`Module ${args.module} not found`);

    if (root.startsWith(backendConfig.installationroot))
      throw new CLIRuntimeError(`Module ${args.module} is a builtin module and cannot be converted`);

    const status = await simpleGit({ baseDir: root }).status();
    if (!status.isClean())
      throw new CLIRuntimeError(`Module ${root} appears to have uncommitted changes, please commit or stash them before running es2ts`);

    //ensure tsconfig is present
    const tsConfigFile = root + "tsconfig.json";
    await storeDiskFile(tsConfigFile, await generateTSConfigTextForModule(args.module), { overwrite: true, onlyIfChanged: true });

    //build us a host!
    const originalFiles = await listDirectory(root, { recursive: true, mask: /\.es$/ });

    console.log("Converting all .es files to .tsx...");
    const output = new Map<string, string>();
    for (const file of originalFiles) {
      let code = await readFile(file.fullPath, 'utf8');

      //Remove .es extensions from import statements. Prefix the code with an empty line so we can prefix comments, we'll trim it later if it wasn't needed
      code = "\n" + code.replaceAll(/^(import .*)(\.es)/gm, (match, p1) => p1);

      //Cache the code
      const newPath = file.fullPath.replace(/\.es$/, '.tsx');
      output.set(newPath, code);

      /* We could probably set up a tshost with a fake filesystem to avoid writing intermediate situations too disk...
         but unlikely to be worth it for transforms we'll do only once. Just backup your code before running es2ts */
      await storeDiskFile(newPath, code, { overwrite: true });
    }

    console.log("Figuring out which .tsx files can become .ts...");
    const { program, diagnostics } = await prepTSHost(tsConfigFile, { setFiles: [...output.keys()], ignoreErrors: true });
    const brokenFiles = new Set(diagnostics.map(_ => _.file?.fileName));

    //Complete TSX->TS conversion before starting to lint, or the lint will get confused by the renames
    for (let [file, code] of [...output.entries()]) {
      const sourceFile = program.getSourceFile(file);
      if (!sourceFile)
        throw new Error(`Could not find source file ${file}`);

      if (brokenFiles.has(file))
        code = "// @ts-nocheck -- Bulk rename done by wh devkit:es2ts\n" + code;

      if (!containsJSX(sourceFile)) { //then it can become a ts file
        output.delete(file);
        const newName = file.replace(/\.tsx$/, '.ts');
        await rename(file, newName);
        file = newName;
      }

      //Add or update the file and code
      output.set(file, code);
    }

    console.log("Linting and reformatting the files");
    for (let [file, code] of [...output.entries()]) {
      const fixed = await handleLintingCommand(toResourcePath(file), code, true, true);
      if (fixed.hasfixes)
        code = Buffer.from(fixed.output, 'base64').toString('utf8'); //handleLintingCommand returns base64 output.

      if (fixed.messages.some(_ => _.fatal))
        code = '/* eslint-disable */\n' + code;

      await storeDiskFile(file, code.trim() + '\n', { overwrite: true });
    }

    //If we get here, it should be safe to remove the es files
    console.log("Deleting the original .es files");
    for (const file of originalFiles)
      await rm(file.fullPath);

    console.log("DONE! 🎉");
    console.log("Now run checkmodule, update any testinfo.xml files, and either commit or reset all the changes");
  }
});
