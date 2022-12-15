import * as fs from "node:fs";
import * as stacktrace_parser from "stacktrace-parser";
import * as node_path from "path";
import ts from "typescript";
import { SchemaObject } from "ajv";
import * as TJS from "typescript-json-schema";

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
}

/** Typescript parsing is slow, so cache the program */
const programcache: Record<string, TJS.Program> = {};

export async function getJSONSchemaFromTSType(typeref: string, options: LoadTSTypeOptions = {}): Promise<TJS.Definition> {

  let file = typeref.split("#")[0];
  const typename = typeref.split("#")[1];

  const fileref = file;
  if (file.startsWith("@mod-"))
    file = require.resolve(file);

  let tsconfigdir = "";
  if (process.env["WEBHARE_DIR"] && file.startsWith(process.env["WEBHARE_DIR"]))
    tsconfigdir = process.env["WEBHARE_DIR"];
  else if (process.env["WEBHARE_DATAROOT"] && file.startsWith(process.env["WEBHARE_DATAROOT"]))
    tsconfigdir = process.env["WEBHARE_DATAROOT"];
  else
    throw new Error(`Cannot find relevant tsconfig.json file for ${JSON.stringify(file)}`);

  let program = programcache[file];
  if (!program) {
    // Read and parse the configuration file
    const { config } = ts.readConfigFile(node_path.join(tsconfigdir, "tsconfig.json"), ts.sys.readFile);
    const { options: tsOptions, errors } = ts.parseJsonConfigFileContent(config, ts.sys, tsconfigdir);

    // Parse file with the definition
    program = ts.createProgram({ options: tsOptions, rootNames: [file], configFileParsingDiagnostics: errors });

    const diagnostics = ts.getPreEmitDiagnostics(program).concat(errors);
    if (diagnostics.length) {
      const host = {
        getCurrentDirectory: () => process.cwd(),
        getCanonicalFileName: (path: string) => path,
        getNewLine: () => "\n"
      };

      const message = ts.formatDiagnostics(diagnostics, host);
      console.error(message);
      throw new Error(`Got errors compiling file: ${JSON.stringify(fileref)}: ${message}`);
    }

    programcache[file] = program;
  }

  const schema = TJS.generateSchema(program, typename, {
    required: true,
    noExtraProps: true,
    ...options
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

