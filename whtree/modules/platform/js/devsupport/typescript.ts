import ts from "typescript";
import * as path from "node:path";
import { backendConfig, toResourcePath } from "@webhare/services";
import { getModuleValidationConfig, getValidatableFiles, type ValidationMessageWithType } from "./validation";
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

function getCircularImports(compiler: ts.CompilerHost, tsOptions: ts.CompilerOptions, program: ts.Program) {
  const analysisResult: {
    file: string;
    cycle: string[];
  }[] = [];

  /// References of a file
  type Ref = { name: string; from: Set<Ref>; to: Set<Ref> };

  /// List of all files
  const refs = new Map<string, Ref>;

  /// Get/create a ref for a file name
  function getRef(name: string): Ref {
    let ref = refs.get(name);
    if (!ref) {
      ref = { name: name, from: new Set, to: new Set };
      refs.set(name, ref);
    }
    return ref;
  }

  for (const sourcefile of program.getSourceFiles()) {
    // Ignore all node_modules files
    if (sourcefile.fileName.indexOf("node_modules") !== -1)
      continue;

    const fromref = getRef(sourcefile.fileName);

    // Walk over all 'important' nodes (skips over stuff like naked semicolons)
    ts.forEachChild(sourcefile, node => {
      // ignore type-only imports/exports
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
        return;
      if (ts.isExportDeclaration(node) && node.isTypeOnly)
        return;

      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = ts.resolveModuleName(node.moduleSpecifier.text, sourcefile.fileName, tsOptions, compiler);

          if (resolved.resolvedModule) {
            // ignore loads of node_modules
            if (resolved.resolvedModule.resolvedFileName.indexOf("node_modules") !== -1)
              return;
            const toref = getRef(resolved.resolvedModule.resolvedFileName);
            fromref.to.add(toref);
            toref.from.add(fromref);
          }
        }
      }
    });
  }

  // Remove all files that aren't references or don't have references themselves
  function removeLeaves() {
    for (; ;) {
      let anychanged = false;
      for (const v of refs.values()) {
        if (!v.to.size) {
          anychanged = true;
          refs.delete(v.name);
          for (const f of v.from.values())
            f.to.delete(v);
        }
        if (!v.from.size) {
          anychanged = true;
          refs.delete(v.name);
          for (const f of v.to.values())
            f.from.delete(v);
        }
      }
      if (!anychanged)
        break;
    }
  }

  // Removes a single reference
  function removeEdge(from: Ref, to: Ref) {
    if (!from.to.has(to))
      throw new Error(`edge does not exist`);
    to.from.delete(from);
    from.to.delete(to);
  }

  // Finds the shortest reference involving a file
  function findShortestCycle(root: Ref) {
    // breadth-first search, keeping how we got to a file
    const directions = new Map<Ref, Ref>;
    const todo = [root];
    for (const elt of todo) {
      for (const c of elt.to) {
        //console.log(elt.name, "->", c.name);
        if (c === root) {
          const result: Ref[] = [];
          for (let iter: Ref | undefined = elt; iter; iter = directions.get(iter))
            result.unshift(iter);
          return result;

          // shortest cycle
        } else if (!directions.get(c)) {
          directions.set(c, elt);
          todo.push(c);
        }
      }
    }
    return [];
  }

  removeLeaves();

  while (refs.size) {
    for (const todo of refs.values()) {
      const cycle = findShortestCycle(todo);
      if (!cycle.length)
        continue;

      analysisResult.push({ file: todo.name, cycle: cycle.map(r => r.name) });

      removeEdge(cycle[0], cycle[1] ?? cycle[0]);
      removeLeaves();
      break;
    }

  }
  return analysisResult;
}

async function getTSCFiles(modulename: string) {
  const config = await getModuleValidationConfig(modulename === "jssdk" ? "platform" : modulename);
  return await getValidatableFiles(config, modulename, { fileMask: /\.(ts|tsx)$/ });
}

export async function checkUsingTSC(modulename: string, options?: { files: string[] }): Promise<ValidationMessageWithType[]> {
  const isPlatform = modulename === "jssdk" || whconstant_builtinmodules.includes(modulename);
  const projectRoot = isPlatform ? backendConfig.installationRoot : backendConfig.module[modulename].root;
  const projectFile = projectRoot + "tsconfig.json";
  if (!isPlatform) //Update if needed
    await storeDiskFile(projectFile, await generateTSConfigTextForModule(modulename), { overwrite: true, onlyIfChanged: true });

  const tsbuildinfodir = backendConfig.dataRoot + "caches/platform/typescript";
  await mkdir(tsbuildinfodir, { recursive: true });

  const files = options?.files ?? await getTSCFiles(modulename);
  let { host, tsOptions, program, diagnostics, builderProgram } = await prepTSHost(projectFile, { setFiles: files, ignoreErrors: true, tsBuildInfoFile: path.join(tsbuildinfodir, modulename + ".tsbuildinfo") });

  const emitResult = builderProgram.emit();
  diagnostics = diagnostics.concat(emitResult.diagnostics);
  const circularImports = getCircularImports(host, tsOptions, program);

  return [
    ...mapDiagnostics(projectRoot, diagnostics),
    ...circularImports.map(cycle => {
      // Report only cycles that involve the checked module
      if (!cycle.cycle.some(c => c.startsWith(projectRoot)))
        return null;
      return {
        type: "hint" as const,
        resourcename: toResourcePath(cycle.file, { keepUnmatched: true }),
        line: 0,
        col: 0,
        message: `Circular import detected: ${cycle.cycle.map(file => toResourcePath(file, { keepUnmatched: true })).join(" => ")}`,
        source: "tsc-circular-import"
      };
    })
  ].filter(_ => _ !== null).filter(_ => !_.message.startsWith("No inputs were found"));
}
