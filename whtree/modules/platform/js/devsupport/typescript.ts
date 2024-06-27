import { readFile } from "fs/promises";
import * as ts from "typescript";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { backendConfig, toFSPath, toResourcePath } from "@webhare/services";
import type { ValidationMessageWithType } from "./validation";
import { mkdir } from "node:fs/promises";
import { loadlib } from "@webhare/harescript/src/contextvm";

function mapDiagnostics(basedir: string, diagnostics: ts.Diagnostic[]): ValidationMessageWithType[] {
  const issues: ValidationMessageWithType[] = [];
  diagnostics.forEach(diagnostic => {
    let type: "error" | "warning" | "hint" = diagnostic.category === ts.DiagnosticCategory.Error ? "error" : diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "hint";
    if (diagnostic.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const resourcename = toResourcePath(diagnostic.file.fileName, { keepUnmatched: true });

      if (resourcename.includes("/vendor/"))
        type = "hint";
      if (resourcename.startsWith("mod::webhare_testsuite/")) //TODO REMOVE demotion to hint so testsuite comes into scope (ie API checks!)
        type = "hint";

      issues.push({
        type,
        resourcename,
        line: line + 1,
        col: character + 1,
        message,
        source: "tsc"
      });
    } else {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      issues.push({
        type,
        resourcename: toResourcePath(basedir, { keepUnmatched: true }),
        line: 0,
        col: 0,
        message,
        source: "tsc"
      });
    }
  });
  return issues;
}

/* Gather list of files to compile

  TODO why is command line tsc ignoring node_modules? our tsconfig.json files don't explicitly request it, --showConfig indeed shows
   an implied files[] list without node_modules, but I can't find it documented anywhere what happens without include and files */
async function getTSFilesRecursive(startpath: string): Promise<string[]> {
  const entries = await fs.readdir(startpath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules")
        result.push(...await getTSFilesRecursive(path.join(startpath, entry.name)));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      result.push(path.join(startpath, entry.name));
  }
  return result;
}

export async function checkUsingTSC(modulename: string): Promise<ValidationMessageWithType[]> {
  const baseconfig = JSON.parse(await readFile(backendConfig.installationroot + "tsconfig.json", 'utf-8')); //ie: whtree/tsconfig.json
  const compileroptions = baseconfig.compilerOptions;

  //Discover root of the project and which paths to compile
  let projectRoot = '';
  const rootpaths = [];
  if (modulename === "platform") {
    //We're building the platform
    projectRoot = backendConfig.installationroot;
    rootpaths.push(backendConfig.installationroot + "jssdk", backendConfig.installationroot + "modules");
  } else {
    projectRoot = backendConfig.module[modulename].root;
    rootpaths.push(projectRoot);
  }

  /* Gather list of files to compile
     TODO why is command line tsc ignoring node_modules? our tsconfig.json files don't explicitly request it, --showConfig indeed shows
     an implied files[] list without node_modules, but I can't find it documented anywhere what happens without include and files */
  const rootnames = [];
  for (const root of rootpaths)
    rootnames.push(...await getTSFilesRecursive(root));

  if (!rootnames.length)
    return []; //don't bother launching TSC, no TypeScript here

  if (modulename !== "platform") { //apply decentral tsconfig.json
    //Update if needed. But we could just calculate it directly and make actual on-disk storage wh fixupmodule or dev's problem...
    await loadlib("mod::system/lib/internal/modulemanager.whlib").BuildTSConfigFile(projectRoot);

    //We're building a submodule
    const tsconfigres = `mod::${modulename}/tsconfig.json`;
    const tsconfigpath = toFSPath(tsconfigres);
    let tsconfig;
    try {
      //TODO consider feeding the generated tsconfig.json directly to our code, then we won't even need to have it just to checkmodule. (but VSCode & tsrun will still need it!)
      tsconfig = JSON.parse(await readFile(tsconfigpath, 'utf8'));
    } catch (e) {
      return [{ type: "error", resourcename: tsconfigres, message: `Unable to open tsconfig.json: ${(e as Error).message}`, col: 1, line: 1, source: "tsc" }];
    }

    Object.assign(compileroptions, tsconfig.compilerOptions); //overwrite any set options
  }

  //Complete compiler options
  const converted = ts.convertCompilerOptionsFromJson(compileroptions, projectRoot, "tsconfig.json");
  if (converted.errors.length)
    return mapDiagnostics(projectRoot, converted.errors);
  converted.options.noEmit = true;
  converted.options.incremental = true;

  //TODO move to storage/ somewhere or something that otherwise has a CACHEDIR.tag ? (not that it's really much data...) - or some dir that is recreated every WebHarere/container restart like the compilecache
  const tsbuildinfodir = backendConfig.dataroot + "ephemeral/system.typescript";
  await mkdir(tsbuildinfodir, { recursive: true });
  converted.options.tsBuildInfoFile = path.join(tsbuildinfodir, modulename + ".tsbuildinfo");

  //The actual TypeScript compilation:
  const program = ts.createProgram({
    rootNames: rootnames,
    options: converted.options
  });

  const emitResult = program.emit();
  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  return mapDiagnostics(projectRoot, allDiagnostics);
}
