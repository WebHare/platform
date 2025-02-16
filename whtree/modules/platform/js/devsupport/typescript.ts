import ts from "typescript";
import * as path from "node:path";
import { backendConfig, toResourcePath } from "@webhare/services";
import type { ValidationMessageWithType } from "./validation";
import { mkdir } from "node:fs/promises";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { storeDiskFile } from "@webhare/system-tools";
import { generateTSConfigTextForModule } from "@mod-system/js/internal/generation/gen_typescript";
import { prepTSHost } from "@webhare/test/src/testsupport";

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

export async function checkUsingTSC(modulename: string, options?: { files: string[] }): Promise<ValidationMessageWithType[]> {
  const isPlatform = modulename === "jssdk" || whconstant_builtinmodules.includes(modulename);
  const projectRoot = isPlatform ? backendConfig.installationroot : backendConfig.module[modulename].root;
  const projectFile = projectRoot + "tsconfig.json";
  if (!isPlatform) //Update if needed
    await storeDiskFile(projectFile, await generateTSConfigTextForModule(modulename), { overwrite: true, onlyIfChanged: true });

  const tsbuildinfodir = backendConfig.dataroot + "caches/platform/typescript";
  await mkdir(tsbuildinfodir, { recursive: true });

  const { program, diagnostics } = await prepTSHost(projectFile, { setFiles: options?.files, ignoreErrors: true, tsBuildInfoFile: path.join(tsbuildinfodir, modulename + ".tsbuildinfo") });
  if (diagnostics.length)
    return mapDiagnostics(projectRoot, diagnostics);

  const emitResult = program.emit();
  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  return mapDiagnostics(projectRoot, allDiagnostics);
}
