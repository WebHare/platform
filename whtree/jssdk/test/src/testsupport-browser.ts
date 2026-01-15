import * as stacktrace_parser from "stacktrace-parser";
import type { Definition } from "typescript-json-schema";
import type { SchemaObject } from "ajv/dist/2020";

export function reportAssertError(stack: string) {
  //TODO we should probably async-schedule a stacktrace parse and report the sourcemapped location. for now we simply exist to have 'a' testsupport implementation for the browser and preventing node:fs deps
  const badline = stacktrace_parser.parse(stack)[1];
  if (badline?.file && badline.lineNumber) {
    console.log(`test.assert failed in ${badline.file.split('/').slice(-1)[0]} line ${badline.lineNumber}`);
  }
}

export interface LoadTSTypeOptions {
  noExtraProps?: boolean;
  required?: boolean;
}

export async function getJSONSchemaFromTSType(typeref: string, options: LoadTSTypeOptions = {}): Promise<Definition> {
  throw new Error(`Loading a JSON schema for a TypeScript type is not yet supported from the browser testing framework`);
}
export async function getJSONSchemaFromFile(file: string): Promise<SchemaObject> {
  throw new Error(`Loading JSON schema's from a file is not yet supported from the browser testing framework`);
}

export function scheduleLingeringProcessCheck(): void {
  // not needed in browser, only in Node
}

export async function triggerGarbageCollection() {
  throw new Error("triggerGarbageCollection not (yet) implemented for browser test environment");
}

export async function getActiveGenerators(): Promise<{ name: string; location: string; suspendedAt: string }[]> {
  return [];
}
