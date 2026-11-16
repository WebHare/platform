/* JS based validators

   When debugging it may be useful to invoke WASM validate.whscr directly to get console output in the command line, eg
   wh runwasm mod::system/scripts/whcommands/validate.whscr --tids mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.yml
*/

import { backendConfig, getResourceEventMasks, importJSFunction, isAbsoluteResource, resolveResource, ResourceDescriptor, toResourcePath, type WebHareBlob } from "@webhare/services";
import { pick, regExpFromWildcards, throwError } from "@webhare/std";
import { getAjvForSchema, knownJSONSchemaMetaSchemas, type AjvValidateFunction, type JSONSchemaObject } from "@webhare/test/src/ajv-wrapper";
import { getAllModuleYAMLs } from "@webhare/services/src/moduledefparser";
import { validateCompiledSiteProfile } from "./siteprofiles";
import { validateMCPToolNames } from "./moduledefinition";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { elements, getAttr } from "@mod-system/js/internal/generation/xmlhelpers";
import { getApplicabilityError, getMyApplicabilityInfo, isNodeApplicableToThisWebHare, readApplicableToWebHareNode } from "@mod-system/js/internal/generation/shared";
import { listDirectory } from "@webhare/system-tools";
import { decodeYAML, TrackedYAML } from "./yaml";

export { decodeYAML, TrackedYAML };

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
  /** Event masks for invalidation of this validation result, in addition to the masks for the validated resource itself */
  eventmasks = new Array<string>;
  options: ValidationOptions;

  constructor(options: ValidationOptions) {
    this.options = options;
  }

  onTid = (resourcename: string, tid: string) => {
    this.tids.push({ resourcename, tid, line: 0, col: 0 });
  };

  finalize(): ValidationResult {
    return pick(this, ["messages", "icons", "tids", "eventmasks"]);
  }
}

/** Custom content validator function
 * @param resourceName - Resource name being validated
 * @param content - Content to validate, already parsed
 * @param context - Validation context to add messages to
 */
export type ContentValidationFunction<YamlType> = (resourceName: string, content: TrackedYAML<YamlType>, context: ValidationState) => Promise<void>;




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
  } else if (resource.toLowerCase().endsWith(".json")) {
    await runYAMLBasedValidator(result, content, resource, { ...options, json: true });
  } else {
    result.messages.push({ resourcename: resource, line: 0, col: 0, message: `No validator available for '${resource}'`, source: "validation", metadata: {}, type: "hint" });
  }
  return result.finalize();
}


/** Check whether a decoded value can be a JSON schema (an object or a boolean, eg not null from an empty file) */
function isUsableSchema(schema: unknown): schema is JSONSchemaObject | boolean {
  return typeof schema === "boolean" || (typeof schema === "object" && schema !== null && !Array.isArray(schema));
}

/** Get the position of a JSON.parse error, if its message contains one */
function getJSONErrorPosition(text: string, error: Error): ResourcePosition {
  const linecol = error?.message?.match(/\(line (\d+) column (\d+)\)/);
  if (linecol)
    return { line: parseInt(linecol[1]), col: parseInt(linecol[2]) };
  const pos = error?.message?.match(/at position (\d+)/);
  if (pos) {
    const before = text.substring(0, parseInt(pos[1])).split("\n");
    return { line: before.length, col: before[before.length - 1].length + 1 };
  }
  return { line: 0, col: 0 };
}

/** Resolve a $schema reference to a resource path. Accepts absolute resource paths (eg mod::module/data.schema.json) and
    paths relative to the validated resource. Returns null for URLs, throws if the reference can't be resolved */
function resolveSchemaReference(resource: string, ref: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:(?!:)/i.test(ref)) //looks like a URL (scheme followed by a single ':')
    return null;
  //check absolute paths first, resolveResource also requires a supported base (eg not direct::)
  try {
    return isAbsoluteResource(ref) && ref.includes("::") ? ref : resolveResource(resource, ref);
  } catch (e) {
    throw new Error(`Invalid schema reference '${ref}' relative to '${resource}': ${(e as Error)?.message || "Unknown error"}`);
  }
}

/** Validate a YAML or .json file.
 * @param result The validation state to update with errors and warnings.
 * @param content The content of the file to validate.
 * @param resource The resource name or path of the file.
 * @param options Optional validation options, including whether the file is JSON.
 */
export async function runYAMLBasedValidator(result: ValidationState, content: WebHareBlob, resource: string, options?: ValidationOptions & { json?: boolean }): Promise<void> {
  if (resource.startsWith("direct::")) //lives outside a module
    return;

  const baseErrorRec: Omit<ValidationMessageWithType, "message"> = { type: "error", resourcename: resource, line: 0, col: 0, source: "validation", metadata: {} };

  const data = await content.text();
  if (options?.json) {
    //YAML is more lenient than JSON (eg it accepts trailing commas and comments), so check the JSON syntax first
    try {
      JSON.parse(data);
    } catch (e) {
      result.messages.push({ ...baseErrorRec, ...getJSONErrorPosition(data, e as Error), message: (e as Error)?.message || "Invalid JSON" });
      return;
    }
  }

  const tracked = new TrackedYAML<object>(data);
  if (tracked.anyErrors()) {
    result.messages.push(...tracked.getMessages(resource));
    return;
  }

  const validators = await getValidators();
  if (resource.endsWith(".schema.yml") || resource.endsWith(".schema.yaml") || resource.endsWith(".schema.json")) {
    // The resource contains a JSON schema
    if (!isUsableSchema(tracked.doc)) {
      result.messages.push({ ...baseErrorRec, message: "A schema must be an object or a boolean" });
      return;
    }

    const $schema = tracked.doc.$schema;
    if ($schema !== undefined && typeof $schema !== "string") {
      result.messages.push({ ...baseErrorRec, message: "The $schema property must be a string" });
      return;
    }

    if (!$schema || knownJSONSchemaMetaSchemas.includes($schema)) { // Only validate if the $schema is to a known JSON schema metaschema or not present
      const ajv = await getAjvForSchema(tracked.doc);

      // ajv.validateSchema didn't report typo 'desription' vs 'description'? but compile does..
      try {
        ajv.compile(tracked.doc as JSONSchemaObject);
      } catch (e) {
        result.messages.push({ ...baseErrorRec, message: "Cannot validate: " + ((e as Error)?.message || "Unknown error") });
      } finally {
        ajv.removeSchema(tracked.doc);
      }
    } else {
      result.messages.push({ ...baseErrorRec, message: "Unrecognized $schema " + JSON.stringify($schema) });
    }
    return;
  }

  for (const validator of validators) {
    if (!resource.match(validator.resourceMask))
      continue;

    try {
      if (!validator.compiledSchemaValidator) {
        //TODO readResource?
        result.eventmasks.push(...getResourceEventMasks(validator.schema));
        const schema = decodeYAML<JSONSchemaObject>(await (await ResourceDescriptor.fromResource(validator.schema)).file.text());
        if (!isUsableSchema(schema))
          throw new Error(`Schema at '${validator.schema}' is not usable: must be an object or a boolean`);

        const ajv = await getAjvForSchema(schema);
        validator.compiledSchemaValidator = ajv.compile(schema);
      }

      if (!validator.compiledSchemaValidator(tracked.doc)) {
        for (const error of validator.compiledSchemaValidator.errors || []) {
          result.messages.push({
            ...baseErrorRec,
            ...tracked.getPositionForPointer(error.instancePath),
            message: error.message || "Unknown error",
          });
        }
      }

      if (validator.contentValidator) {
        const contentValidator = await importJSFunction<ContentValidationFunction<unknown>>(validator.contentValidator);
        await contentValidator(resource, tracked, result);
      }
    } catch (e) {
      result.messages.push({ ...baseErrorRec, message: (e as Error)?.message || "Unknown error" });
    }

    return;
  }

  // No matching validator, check if the document has a $schema property and attempt to validate against it
  if (typeof tracked.doc === "object" && tracked.doc && "$schema" in tracked.doc && typeof tracked.doc.$schema === "string") {
    try {
      const $schema = tracked.doc.$schema;
      const resourceResolved = resolveSchemaReference(resource, $schema);
      if (!resourceResolved) {
        result.messages.push({ ...baseErrorRec, type: "hint", message: `Ignoring external JSON schema reference '${$schema}'` });
        return;
      }

      result.eventmasks.push(...getResourceEventMasks(resourceResolved));
      const schema = decodeYAML<JSONSchemaObject>(await (await ResourceDescriptor.fromResource(resourceResolved)).file.text());
      if (!isUsableSchema(schema))
        throw new Error(`Schema at '${resourceResolved}' is not usable: must be an object or a boolean`);

      const ajv = await getAjvForSchema(schema);

      const compiled = ajv.compile(schema);
      try {
        delete tracked.doc.$schema;
        if (!compiled(tracked.doc)) {
          for (const error of compiled.errors || []) {
            result.messages.push({
              ...baseErrorRec,
              ...tracked.getPositionForPointer(error.instancePath),
              message: error.message || "Unknown error",
            });
          }
        }
      } finally {
        ajv.removeSchema(schema);
      }
    } catch (e) {
      result.messages.push({ ...baseErrorRec, message: (e as Error)?.message || "Unknown error" });
    }
    return;
  }

  // No validator and no schema, report unvalidated YAML file. No message for JSON, too many JSON files would trigger this otherwise
  if (!options?.json)
    result.messages.push({ ...baseErrorRec, type: "hint", message: `No ${options?.json ? "JSON" : "YAML"} validator available for '${resource}'` });
  return;
}

export async function runJSBasedGlobalValidators(mode: "siteprofiles" | "all", modules: string[] | "*"): Promise<ValidationResult> {
  const result = new ValidationState({});
  await validateCompiledSiteProfile(result, modules);
  if (mode === "all")
    await validateMCPToolNames(result, modules);
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
