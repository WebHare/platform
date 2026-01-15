import * as fs from "node:fs";
import v8 from 'node:v8';
import vm from 'node:vm';
import * as stacktrace_parser from "stacktrace-parser";
import ts from "typescript";
import type { SchemaObject } from "ajv/dist/2020";
import * as TJS from "typescript-json-schema";
import { dumpActiveIPCMessagePorts } from '@mod-system/js/internal/whmanager/transport';
import '@mod-system/js/internal/whmanager/bridge'; // for whmanager registration and automatic error reporting
import { dirname } from "node:path";
import { getTSPolyfills } from "@mod-system/js/internal/generation/gen_typescript";


export function reportAssertError(stack: string) {
  const badline = stacktrace_parser.parse(stack)[1];
  if (badline?.file && badline.lineNumber) {
    console.log(`test.assert failed in ${badline.file.split('/').slice(-1)[0]} line ${badline.lineNumber}`);

    const contents = fs.readFileSync(badline.file).toString().split("\n")[badline.lineNumber - 1];
    console.log(`Offending test: ${contents.trim()}`);
  }
}

export interface LoadTSTypeOptions {
  noExtraProps?: boolean;
  required?: boolean;
  ignoreErrors?: boolean;
}

/** Typescript parsing is slow, so cache the program */
const programcache: Record<string, TJS.Program> = {};

export function getTypeExportsForSourceFile(sourceFile: ts.SourceFile) {
  const allExports: string[] = [];

  visitNode(sourceFile);

  function visitNode(node: ts.Node) {
    if (ts.isExportSpecifier(node)) {
      const name = node.name.getText();
      allExports.push(name);
    } else if (node.kind === ts.SyntaxKind.ExportKeyword) {
      const parent = node.parent;
      if (ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) {
        const name = parent.name?.getText();
        if (name)
          allExports.push(name);
      }
    }
    ts.forEachChild(node, visitNode);
  }

  return allExports;
}

export async function prepTSHost(tsConfigFile: string, options?: { setFiles?: string[]; ignoreErrors?: boolean; tsBuildInfoFile?: string }) {
  // Read and parse the configuration file
  const { config } = ts.readConfigFile(tsConfigFile, ts.sys.readFile);
  const { options: tsOptions, errors, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(tsConfigFile));
  tsOptions.configFilePath = tsConfigFile; //needed to make @types/... lookups independent of cwd
  tsOptions.noEmit = true;
  tsOptions.incremental = true;
  if (options?.tsBuildInfoFile)
    tsOptions.tsBuildInfoFile = options.tsBuildInfoFile;

  //Construct a compilation list, don't touch the arrays we received
  const rootNames = [...(options?.setFiles || fileNames)];
  rootNames.push(...getTSPolyfills()); //ensure any polyfills activated by whnode-preload are visible to the compilers

  const host = ts.createCompilerHost(tsOptions);
  const program = ts.createProgram({ options: tsOptions, host, rootNames, configFileParsingDiagnostics: errors });
  let diagnostics = ts.getPreEmitDiagnostics(program).concat(errors);

  // We can't exclude files from validation, so like checkmodules has to, we'll just discard errors about files we don't care about. TODO shouldn't be hardcoded if we pretend to be generic
  diagnostics = diagnostics.filter(_ => !_.file?.fileName.includes("/vendor/"));

  if (diagnostics.length && !options?.ignoreErrors) {
    const message = ts.formatDiagnostics(diagnostics, host);
    throw new Error(`TypeScript error: ${message}`);
  }

  return { program, diagnostics };
}


export async function getJSONSchemaFromTSType(typeref: string, options: LoadTSTypeOptions = {}): Promise<TJS.Definition> {

  let file = typeref.split("#")[0];
  const typename = typeref.split("#")[1];

  const fileref = file;
  if (file.startsWith("@mod-"))
    file = require.resolve(file);

  const tsconfigfile = ts.findConfigFile(file, ts.sys.fileExists);
  if (!tsconfigfile)
    throw new Error(`Could not find tsconfig.json file for ${JSON.stringify(file)}`);

  let program = programcache[file];
  if (!program) {
    program = (await prepTSHost(tsconfigfile, { setFiles: [file], ignoreErrors: options?.ignoreErrors })).program;
    programcache[file] = program;
  }

  const sourceFile = program.getSourceFile(file);
  if (!sourceFile)
    throw new Error(`Could not find source file ${JSON.stringify(fileref)}`);

  const exports = getTypeExportsForSourceFile(sourceFile);
  if (!exports.includes(typename))
    throw new Error(`Could not find export ${JSON.stringify(typename)} in file ${JSON.stringify(fileref)}. Exports: ${JSON.stringify(exports)}`);

  const schema = TJS.generateSchema(program, typename, {
    required: true,
    noExtraProps: true,
    ...options,
    ignoreErrors: true //we will have thrown them above, now we ignore them
  });

  if (!schema) {
    throw new Error(`Could not generate a JSON schema for type ${JSON.stringify(typeref)}`);
  }

  return schema;
}

export async function getJSONSchemaFromFile(file: string): Promise<SchemaObject> {
  if (file.startsWith("@mod-"))
    file = require.resolve(file);

  return JSON.parse(fs.readFileSync(file).toString("utf-8")) as SchemaObject;
}

interface ProcessUndocumented {
  getActiveResourcesInfo(): string[];
}

function dumpHandlesAndRequests() {
  // ADDME: use something like why-is-node-running to get and dump all stuff
  const p: ProcessUndocumented = process as unknown as ProcessUndocumented;
  console.error('\nTest process is not shutting down after tests, there are probably still active handles or requests');
  console.error('Active resource types:', p.getActiveResourcesInfo());
  dumpActiveIPCMessagePorts();
  process.exit(1);
}

export function scheduleLingeringProcessCheck() {
  setTimeout(() => dumpHandlesAndRequests(), 5000).unref();
}

export async function triggerGarbageCollection() {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  return new Promise<void>(resolve => {
    setImmediate(() => {
      gc();
      resolve();
    });
  });
}

export { getActiveGenerators } from "./inspect-helpers";
