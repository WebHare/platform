/* JS based validators

   When debugging it may be useful to invoke WASM validate.whscr directly to get console output in the command line, eg
   wh runwasm mod::system/scripts/whcommands/validate.whscr --tids mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.yml
*/

import { parseSiteProfile } from "@mod-publisher/lib/internal/siteprofiles/parser";
import { WebHareBlob } from "@webhare/services";
import { pick } from "@webhare/std";
import YAML from "yaml";

/** Basic location pointer used by various validators */
export interface ResourceLocation {
  /** Full resource name (eg mod::x/y/z) */
  resourcename: string;
  /** Line number, 1-based. 0 if unknown or file missing*/
  line: number;
  /** Column number, 1-based. 0 if unknown or file missing */
  col: number;
  /** Length of the text relevant to the error. 0 or missing if unknown */
  length?: number;
}

/** Basic message (erorr, warning) structure used by various validators */
export interface ResourceMessage extends ResourceLocation {
  message: string;
}

export interface ValidationMessage extends ResourceMessage {
  source: string;
  metadata?: unknown;
}

export interface ValidationMessageWithType extends ValidationMessage {
  type: "error" | "warning" | "hint";
}

export type ValidationResult = {
  /** List of hints */
  hints: ValidationMessage[];
  /** List of warnings */
  warnings: ValidationMessage[];
  /** List of errors */
  errors: ValidationMessage[];
  /** List of tids */
  tids: ValidationTid[];
  /** Event masks for invalidation of this validation result */
  eventmasks?: string[];
  /** Icons */
  icons: unknown[];
};

export interface ValidationOptions {
  onlytids?: boolean;
  overridedata?: WebHareBlob;
  performance?: boolean;
  nomissingtids?: boolean;
  nowarnings?: boolean;
  documentation?: boolean;
  eslintmasks?: string[];
}

export interface ValidationTid extends ResourceLocation {
  tid: string;
  attrname?: string;
}

class ValidationState {
  warnings = new Array<ValidationMessage>;
  errors = new Array<ValidationMessage>;
  hints = new Array<ValidationMessage>;
  icons: unknown[] = [];
  tids = new Array<ValidationTid>;

  onTid = (resourcename: string, tid: string) => {
    this.tids.push({ resourcename, tid, line: 0, col: 0 });
  };

  finalize(): ValidationResult {
    return pick(this, ["warnings", "errors", "icons", "tids", "hints"]);
  }
}

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return result;
}

export async function runJSBasedValidator(content: WebHareBlob, resource: string, options: ValidationOptions): Promise<ValidationResult> {
  const result = new ValidationState;
  const data = await content.text();
  if (resource.endsWith(".siteprl.yml") || resource.endsWith("siteprl.yaml")) {
    await parseSiteProfile(resource, { content: data, onTid: result.onTid });
  } else {
    result.hints.push({ resourcename: resource, line: 0, col: 0, message: `No validator available for '${resource}'`, source: "validation", metadata: {} });
  }
  return result.finalize();
}

export function formatValidationMessage(msg: ValidationMessageWithType): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.type[0].toUpperCase()}${msg.type.substring(1)}: ${msg.message}`;
}

export function logValidationMessagesToConsole(messages: ValidationMessageWithType[]): void {
  const msgs = messages.toSorted((lhs, rhs) => lhs.resourcename.localeCompare(rhs.resourcename) || lhs.line - rhs.line || lhs.col - rhs.col);
  for (const msg of msgs) {
    //TODO ANSI Color?
    console.log(formatValidationMessage(msg));
  }
}
