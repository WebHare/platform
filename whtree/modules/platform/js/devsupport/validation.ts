/* JS based validators

   When debugging it may be useful to invoke WASM validate.whscr directly to get console output in the command line, eg
   wh runwasm mod::system/scripts/whcommands/validate.whscr --tids mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.yml
*/

import { backendConfig, importJSFunction, resolveResource, ResourceDescriptor, toResourcePath, type WebHareBlob } from "@webhare/services";
import { pick, regExpFromWildcards, throwError } from "@webhare/std";
import YAML, { LineCounter, type YAMLParseError } from "yaml";
import { getAjvForSchema, type AjvValidateFunction, type JSONSchemaObject } from "@webhare/test/src/ajv-wrapper";
import { getAllModuleYAMLs } from "@webhare/services/src/moduledefparser";
import { validateCompiledSiteProfile } from "./siteprofiles";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { elements, getAttr } from "@mod-system/js/internal/generation/xmlhelpers";
import { getApplicabilityError, getMyApplicabilityInfo, isNodeApplicableToThisWebHare, readApplicableToWebHareNode } from "@mod-system/js/internal/generation/shared";
import { listDirectory } from "@webhare/system-tools";

export interface ResourcePosition {
  /** Line number, 1-based. 0 if unknown or file missing*/
  line: number;
  /** Column number, 1-based. 0 if unknown or file missing */
  col: number;
  /** Length of the text relevant to the error. 0 or missing if unknown */
  length?: number;
}

/** Basic location pointer used by various validators */
export interface ResourceLocation extends ResourcePosition {
  /** Full resource name (eg mod::x/y/z) */
  resourcename: string;
}

/** Basic message (erorr, warning) structure used by various validators */
export interface ResourceMessage extends ResourceLocation {
  message: string;
}

export interface ValidationMessage extends ResourceMessage {
  source: string;
  metadata?: unknown;
}

export type ValidationMessageType = "error" | "warning" | "hint";

export interface ValidationMessageWithType extends ValidationMessage {
  type: ValidationMessageType;
}

export type ValidationResult = {
  /** List of messages */
  messages: ValidationMessageWithType[];
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

export class ValidationState {
  messages = new Array<ValidationMessageWithType>;
  icons: unknown[] = [];
  tids = new Array<ValidationTid>;

  constructor(public readonly options: ValidationOptions) {
  }

  onTid = (resourcename: string, tid: string) => {
    this.tids.push({ resourcename, tid, line: 0, col: 0 });
  };

  finalize(): ValidationResult {
    return pick(this, ["messages", "icons", "tids"]);
  }
}

/** Custom content validator function
 * @param resourceName - Resource name being validated
 * @param content - Content to validate, already parsed
 * @param context - Validation context to add messages to
 */
export type ContentValidationFunction<YamlType> = (resourceName: string, content: TrackedYAML<YamlType>, context: ValidationState) => Promise<void>;

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return result;
}

export class TrackedYAML<T> {
  doc: T;
  errors: YAML.YAMLError[];
  private lineCounter = new LineCounter;
  private srcTokens = new WeakMap<object, YAML.CST.Token>;
  private sourcedoc: YAML.Document.Parsed;

  constructor(text: string) {
    this.sourcedoc = YAML.parseDocument(text, { strict: true, version: "1.2", prettyErrors: false, lineCounter: this.lineCounter, keepSourceTokens: true });
    this.errors = this.sourcedoc.errors;
    this.doc = this.toJS(this.sourcedoc.contents) as T;
  }

  anyErrors() {
    return this.errors.length > 0;
  }

  getMessages(resourceName: string): ValidationMessageWithType[] {
    return this.errors.map((e: YAMLParseError): ValidationMessageWithType => {
      const pos = e.pos?.length === 2 ? this.lineCounter.linePos(e.pos[0]) : null;
      return {
        type: "error",
        resourcename: resourceName,
        line: pos?.line || 0,
        col: pos?.col || 0,
        ...e.pos?.length ? { length: e.pos[1] - e.pos[0] } : null,
        message: e.message,
        source: "validation"
      };
    });
  }

  getPositionForPointer(pointer: string): ResourcePosition | null {
    const pointsto = this.sourcedoc.getIn(pointerToYamlPath(pointer)) as { range?: [number] } | undefined;
    return pointsto?.range?.[0] ? this.lineCounter.linePos(pointsto.range[0]) : null;
  }

  // Parse the document to JS but record offsets of all objects/arrays
  private toJS(node: unknown): unknown {
    if (node instanceof YAML.Scalar)
      return node.value;

    if (node instanceof YAML.YAMLSeq) {
      const outarray = node.items.map(item => this.toJS(item)).filter(it => it !== undefined);
      if (node.srcToken)
        this.srcTokens.set(outarray, node.srcToken);
      return outarray;
    }
    if (node instanceof YAML.YAMLMap) {
      const outobj = Object.fromEntries(node.items.
        map(item => [item.key, this.toJS(item.value)]). //convert the YAML obj to [key, jsvalue]
        filter(([key, value]) => value !== undefined)); //filter out funny stuff
      if (node.srcToken)
        this.srcTokens.set(outobj, node.srcToken);
      return outobj;
    }
    return undefined;
  }

  getPosition(node: unknown): ResourcePosition | null {
    const tok = this.srcTokens.get(node as object);
    if (!tok)
      return null;

    return { ...this.lineCounter.linePos(tok.offset) };
  }
}


//TODO cache and invalidate validator list as needed
async function getValidators(): Promise<Array<{
  resourceMask: RegExp;
  schema: string;
  contentValidator: string;

  compiledSchemaValidator?: AjvValidateFunction;
}>> {
  const retval = [];

  for (const mod of await getAllModuleYAMLs()) {
    for (const validator of mod.moduleFileTypes || []) {
      const resourceMask = new RegExp(validator.resourceMask, 'i');
      const schema = resolveResource(mod.baseResourcePath, validator.schema);
      const contentValidator = resolveResource(mod.baseResourcePath, validator.contentValidator || '');
      retval.push({ resourceMask, schema, contentValidator });
    }
  }

  return retval;
}

export async function runJSBasedValidator(content: WebHareBlob, resource: string, options?: ValidationOptions): Promise<ValidationResult> {
  const result = new ValidationState({ ...options });

  if (resource.endsWith(".yml") || resource.endsWith(".yaml")) {
    await runYAMLBasedValidator(result, content, resource, options);
  } else {
    result.messages.push({ resourcename: resource, line: 0, col: 0, message: `No validator available for '${resource}'`, source: "validation", metadata: {}, type: "hint" });
  }
  return result.finalize();
}

/** Convert /apply/0 path to ['apply','0'] */
function pointerToYamlPath(ptr: string): string[] {
  //doesn't YAML have an API to do this?
  return ptr.substring(1).split('/');
}

export async function runYAMLBasedValidator(result: ValidationState, content: WebHareBlob, resource: string, options?: ValidationOptions): Promise<void> {
  const data = await content.text();
  const tracked = new TrackedYAML<object>(data);

  if (tracked.anyErrors()) {
    result.messages.push(...tracked.getMessages(resource));
    return;
  }

  const validators = await getValidators();
  if (resource.endsWith(".schema.yml")) {
    const ajv = await getAjvForSchema(tracked.doc as JSONSchemaObject);

    // ajv.validateSchema didn't report typo 'desription' vs 'description'? but compile does..
    try {
      ajv.compile(tracked.doc as JSONSchemaObject);
    } catch (e) {
      //but we won't get errorinfo this way. well at least we get *some* indication the schema is broken
      result.messages.push({ type: "error", resourcename: resource, line: 0, col: 0, message: (e as Error)?.message || "Unknown error", source: "validation", metadata: {} });
    }
    return;
  }

  for (const validator of validators) {
    if (!resource.match(validator.resourceMask))
      continue;

    if (!validator.compiledSchemaValidator) {
      //TODO readResource?
      const schema = decodeYAML<JSONSchemaObject>(await (await ResourceDescriptor.fromResource(validator.schema)).resource.text());

      const ajv = await getAjvForSchema(schema);
      validator.compiledSchemaValidator = ajv.compile(schema);
    }

    if (!validator.compiledSchemaValidator(tracked.doc)) {
      for (const error of validator.compiledSchemaValidator.errors || []) {
        result.messages.push({
          type: "error",
          resourcename: resource,
          line: 0,
          col: 0,
          ...tracked.getPositionForPointer(error.instancePath),
          message: error.message || "Unknown error",
          source: "validation",
          metadata: {}
        });
      }
    }

    if (validator.contentValidator) {
      const contentValidator = await importJSFunction<ContentValidationFunction<unknown>>(validator.contentValidator);
      await contentValidator(resource, tracked, result);
    }
    return;
  }

  result.messages.push({ type: "hint", resourcename: resource, line: 0, col: 0, message: `No YAML validator available for '${resource}'`, source: "validation", metadata: {} });
  return;
}

export async function runJSBasedGlobalValidators(mode: "siteprofiles" | "all", modules: string[] | "*"): Promise<ValidationResult> {
  const result = new ValidationState({});
  await validateCompiledSiteProfile(result, modules);
  return result.finalize();
}

export type ModuleValidationConfig = {
  /** List of masks for files to exclude from validation */
  excludemasks: Array<{ mask: string; why: string; permanent: boolean }>;
  /** List of messages to ignore during validation */
  ignoremessages: Array<{ mask: string; regex?: string }>;
  /** 'true' if this module isn't allowed to run on this webhare installation */
  futuremodule: boolean;
  /** Explains why the module isn't allowed to run on this webhare installation */
  futuremodulewhy: string;
  /** 'true' if validation should fail when any harescript file has a warning */
  perfectcompile: boolean;
  /** 'true' if validation should fail when any tids are missing */
  nomissingtids: boolean;
  /** 'true' if validation should fail when any warnings are found (does not necessarily include warnings added since 2024) */
  nowarnings: boolean;
  /** List of masks for files to validate with eslint */
  eslintmasks: string[];
  /** List of masks for files to format */
  formatmasks: string[];
  /** List of masks for files to exclude from formatting */
  formatexcludemasks: string[];
};

/** Returns the validation configuration for a module
    @param modulename - Name of the module
    @returns Validation configuration for the specified module
*/
export async function getModuleValidationConfig(modulename: string): Promise<ModuleValidationConfig> {
  const config: ModuleValidationConfig = {
    excludemasks: [{ mask: "localtests/*", why: "Non-validated tests", permanent: true }],
    ignoremessages: [],
    futuremodule: false,
    futuremodulewhy: "",
    perfectcompile: false,
    nomissingtids: false,
    nowarnings: false,
    eslintmasks: ["*.ts", "*.tsx"],
    formatmasks: [],
    formatexcludemasks: []
  };
  if (!modulename) //TODO who needs this? copied from HS code
    return config;

  //parse the moduledef and get any exclusions
  const context = await buildGeneratorContext([modulename], false);
  const moddefXML = context.moduledefs.find(m => m.name === modulename)?.modXml;
  if (!moddefXML) {
    throw new Error(`Module definition XML not found for module ${modulename}`);
  }

  const validation = moddefXML.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "validation")[0];
  if (validation) {
    //ADDME warn or fail about unknown options to prevent typos? but only if we know we are 'develop' and have perfect knowledge of acceptable options
    //Document options here in moduledefinition.xsd
    const options = getAttr(validation, "options", []);
    config.perfectcompile = options.includes("perfectcompile");
    config.nomissingtids = options.includes("nomissingtids");
    config.nowarnings = options.includes("nowarnings");

    for (const ignoremessage of elements(validation.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "ignoremessage")))
      config.ignoremessages.push({
        mask: `mod::${modulename}/${getAttr(ignoremessage, "mask", "")}`,
        regex: getAttr(ignoremessage, "regex", "")
      });

    for (const excl of elements(validation.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "exclude"))) {
      if (!isNodeApplicableToThisWebHare(excl, "", { unsafeEnv: true }))
        continue;

      config.excludemasks.push({
        mask: getAttr(excl, "mask", ""),
        why: getAttr(excl, "why", ""),
        permanent: getAttr(excl, "permanent", false)
      });
    }

    for (const excl of elements(validation.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "eslint"))) {
      if (!isNodeApplicableToThisWebHare(excl, "", { unsafeEnv: true }))
        continue;

      config.eslintmasks.push(...getAttr(excl, "mask", []));
      config.eslintmasks.push(...getAttr(excl, "masks", []));
    }

    for (const excl of elements(validation.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "format"))) {
      if (!isNodeApplicableToThisWebHare(excl, "", { unsafeEnv: true }))
        continue;

      config.formatmasks.push(...getAttr(excl, "masks", []));
      config.formatexcludemasks.push(...getAttr(excl, "excludemasks", []));
    }
  }

  const packaging = moddefXML.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "packaging")[0];
  if (packaging) {
    config.futuremodulewhy = getApplicabilityError(getMyApplicabilityInfo({ unsafeEnv: true }), readApplicableToWebHareNode(packaging, "")) || '';
    config.futuremodule = config.futuremodulewhy !== "";

  }

  return config;
}

export async function getValidatableFiles(validateconfig: ModuleValidationConfig, modulename: string, options?: {
  onSkippedFile?: ((resname: string, reason: string) => void) | null;
  fileMask?: string | RegExp;
}): Promise<string[]> {
  const root = modulename === "jssdk" ?
    `${backendConfig.installationRoot}jssdk`
    : (backendConfig.module[modulename] ?? throwError(`Module ${modulename} not found`)).root;
  const excludeMasks = validateconfig.excludemasks.map(e => ({ ...e, regex: regExpFromWildcards(e.mask, { caseInsensitive: true }) }));

  const validatableFiles: string[] = [];
  //We skip any dot files/dirs (includes .git), node_modules and vendor
  fileLoop: for (const entry of await listDirectory(root, { recursive: true, mask: options?.fileMask, skip: /(^\.)|(^node_modules$)|(^vendor$)/ })) {
    if (entry.type !== "file")
      continue;

    for (const mask of excludeMasks) {
      if (mask.regex.test(entry.subPath)) {
        if (!mask.permanent && options?.onSkippedFile)
          options.onSkippedFile(entry.subPath, mask.why);
        continue fileLoop;
      }
    }

    validatableFiles.push(entry.fullPath);
  }
  return validatableFiles;
}

export async function getValidatableFilesHS(validateconfig: ModuleValidationConfig, modulename: string, options?: {
  printskippedfile?: boolean;
  filemask?: string;
}): Promise<string[]> {
  const jssdkroot = `${backendConfig.installationRoot}jssdk/`;
  const files = await getValidatableFiles(validateconfig, modulename, {
    onSkippedFile: options?.printskippedfile ? (resname, reason) => console.log(`Info: Skipping ${resname} because: ${reason}`) : undefined,
    fileMask: options?.filemask
  });

  //HS validation works on resource paths, so we have to use direct:// for the JSSDK
  return files.map(f => f.startsWith(jssdkroot) ? `direct::${f}` : toResourcePath(f));
}
