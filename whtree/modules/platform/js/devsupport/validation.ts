/* JS based validators

   When debugging it may be useful to invoke WASM validate.whscr directly to get console output in the command line, eg
   wh runwasm mod::system/scripts/whcommands/validate.whscr --tids mod::webhare_testsuite/webdesigns/basetestjs/basetestjs.siteprl.yml
*/

import { importJSFunction, resolveResource, ResourceDescriptor, type WebHareBlob } from "@webhare/services";
import { pick } from "@webhare/std";
import YAML, { LineCounter, type YAMLParseError } from "yaml";
import { getAjvForSchema, type AjvValidateFunction, type JSONSchemaObject } from "@webhare/test/src/ajv-wrapper";
import { getAllModuleYAMLs } from "@webhare/services/src/moduledefparser";

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
export type ContentValidationFunction<YamlType> = (resourceName: string, content: YamlType, context: ValidationState) => Promise<void>;

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return result;
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
  const counters = new LineCounter;
  const sourcedoc = YAML.parseDocument(data, { strict: true, version: "1.2", prettyErrors: false, lineCounter: counters });

  if (sourcedoc.errors.length) {
    result.messages.push(...sourcedoc.errors.map((e: YAMLParseError): ValidationMessageWithType => {
      const pos = e.pos?.length === 2 ? counters.linePos(e.pos[0]) : null;
      return {
        type: "error",
        resourcename: resource,
        line: pos?.line || 0,
        col: pos?.col || 0,
        message: e.message,
        source: "validation"
      };
    }));
    return;
  }

  const yamldata = sourcedoc.toJS();
  const validators = await getValidators();

  if (resource.endsWith(".schema.yml")) {
    const ajv = await getAjvForSchema(yamldata as JSONSchemaObject);

    // ajv.validateSchema didn't report typo 'desription' vs 'description'? but compile does..
    try {
      ajv.compile(yamldata as JSONSchemaObject);
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

    if (!validator.compiledSchemaValidator(yamldata)) {
      for (const error of validator.compiledSchemaValidator.errors || []) {
        const pointsto = sourcedoc.getIn(pointerToYamlPath(error.instancePath)) as { range?: [number] } | undefined;
        const pos = pointsto?.range?.[0] ? counters.linePos(pointsto.range[0]) : null;
        result.messages.push({
          type: "error",
          resourcename: resource,
          line: pos?.line || 0,
          col: pos?.col || 0,
          message: error.message || "Unknown error",
          source: "validation",
          metadata: {}
        });
      }
    }

    if (validator.contentValidator) {
      const contentValidator = await importJSFunction<ContentValidationFunction<unknown>>(validator.contentValidator);
      await contentValidator(resource, yamldata, result);
    }
    return;
  }

  result.messages.push({ type: "hint", resourcename: resource, line: 0, col: 0, message: `No YAML validator available for '${resource}'`, source: "validation", metadata: {} });
  return;
}
