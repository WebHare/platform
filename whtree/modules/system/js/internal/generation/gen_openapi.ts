import { whconstant_builtinmodules } from "../webhareconstants";
import type { FileToUpdate, GenerateContext } from "./shared";
import SwaggerParser from "@apidevtools/swagger-parser";
import { astToString, type OpenAPI3, type SchemaObject } from "openapi-typescript";
import type { OpenAPIV3 } from "openapi-types";
import { HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import { splitFileReference } from "@webhare/services/src/naming";
import { backendConfig, toFSPath } from "@webhare/services";
import { getExtractedConfig } from "../configuration";
import type { OpenAPIDescriptor } from "./gen_extracts";
import { promises as fs } from "node:fs";
import { decodeYAML } from "@mod-platform/js/devsupport/validation";



function convertStatusCodes(result: string) {
  return result.split("\n").map(line => {
    const match = /^( {16})(\d\d\d)(.*)$/.exec(line);
    if (match) {
      let code: number | string = Number(match[2]);
      if (code in HTTPSuccessCode)
        code = `[HTTPSuccessCode.${HTTPSuccessCode[code]}]`;
      else if (code in HTTPErrorCode)
        code = `[HTTPErrorCode.${HTTPErrorCode[code]}]`;
      return `${match[1]}${code}${match[3]}`;
    }
    return line;
  }).join("\n");
}

function encodeJSONReferenceProperty(prop: string) {
  return prop.replace(/~/g, '~0').replace(/\//g, '~1');
}

function findJSONReference(root: unknown, prop: string) {
  if (!prop.startsWith("#/")) {
    return null;
  }
  const parts = prop.slice(2).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = root;
  for (const part of parts) {
    if (typeof node !== "object" || !node || !(part in node))
      return null;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function addTags(root: object, node: object, tag: string, path: string) {
  while ("$ref" in node && typeof node.$ref === "string") {
    const elt = findJSONReference(root, node.$ref);
    if (typeof elt !== "object" || !elt) {
      return;
    }
    path = node.$ref;
    node = elt;
  }

  if ("type" in node
    && node.type === "object"
    && "properties" in node
    && node.properties
    && typeof node.properties === "object") {
    (node.properties as Record<string, unknown>).__internal_format_tag = { type: "string", const: tag };
  } else if ("allOf" in node && Array.isArray(node.allOf)) {
    let idx = 0;
    for (const elt of node.allOf) {
      addTags(root, elt, tag, `${path}/allOf/${idx}`);
      ++idx;
    }
  }
}

/// Remove all properties with name $defs, recusively
function recursiveRemoveDefs(node: unknown, path: string, visited: Set<unknown>) {
  if (visited.has(node))
    return;
  visited.add(node);
  if (node && typeof node === "object") {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; ++i)
        recursiveRemoveDefs(node[i], `${path}/${i}`, visited);
    } else {
      if ("$defs" in node)
        delete node["$defs"];
      for (const [key, value] of Object.entries(node))
        if (value && typeof value === "object")
          recursiveRemoveDefs(value, `${path}/${key}`, visited);
    }
  }
}

/** Adds optional property "__internal_format_tag": "openapi-subtag-propertykey" to all properties of nodes marked with "x-webhare-add-format-tags": "subtag"
 *
 */
function addInternalFormatTags(root: object, node: object, path: string) {
  if ("x-webhare-add-format-tags" in node
    && node["x-webhare-add-format-tags"]
    && "properties" in node
    && node.properties
    && typeof node.properties === "object") {
    for (const [key, value] of Object.entries(node.properties)) {
      if (!value || typeof value !== "object")
        continue;
      addTags(root, value, `openapi-${node["x-webhare-add-format-tags"]}-${key}`, `${path}/properties/${encodeJSONReferenceProperty(key)}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((elt, idx) => {
        if (elt && typeof elt === "object")
          addInternalFormatTags(root, elt, `${path}/${encodeJSONReferenceProperty(key)}/${idx}`);
      });
    } else if (value && typeof value === "object")
      addInternalFormatTags(root, value, `${path}/${encodeJSONReferenceProperty(key)}`);
  }
}

/** Moves all SchemaObjects that are used more than once to a $defs.__sharedDefXXX and replaces them with a $ref.
 *  This way of using references can be handled by openapi-type (which doesn't handle references that reference
 *  within a path schema or inside an allOf or anyOf node correctly).
 */
function moveSharedSchemaObjects(parsed: OpenAPI3) {
  // Detect all shared schema objects
  const visited = new Set<SchemaObject>;
  const shared = new Set<SchemaObject>;
  detectSharedSchemaObjectsIterate(parsed, parsed, visited, shared, "", undefined, "#");

  if (!visited.size)
    return;

  const remap = new Map<object, { $ref: string }>;
  if (!parsed.components)
    parsed.components = {};
  if (!parsed.components.schemas)
    parsed.components.schemas = {};

  let idx = 0;
  const defs: Record<string, SchemaObject> = {};
  for (const node of shared) {
    let defName;
    do //guard against name clashes (reprocessing our own schema somehow?)
      defName = `__sharedDef${++idx}`;
    while (defName in parsed.components.schemas);

    defs[defName] = node; //we're not adding them to the openapi doc yet or we would reprocess them and point thme to themselves
    remap.set(node, { $ref: `#/components/schemas/${defName}` });
  }

  replaceRefsIterate(parsed, remap, new Set, "#", true);
  for (const movedValue of Object.values(defs))
    replaceRefsIterate(movedValue, remap, new Set, "#/components/schemas", true);

  Object.assign(parsed.components.schemas, defs);
}

function detectSharedSchemaObjectsIterate(parsed: OpenAPI3, node: object, visited: Set<object>, shared: Set<object>, keyname: string, isSchema: boolean | undefined, path: string) {
  /* This function uses heuristics to detect SchemaObjects. Everything within an 'example' key is probably not a Schema
     object. An array is probably not a Schema object, and the value of a 'properties' key are also probably not Schema,
     but should be checked recursively
  */
  if (keyname === "example") // don't use $ref in examples
    return;
  if (keyname === "schema" || keyname === "schemas" || keyname === "$defs")
    isSchema = true;

  if (Array.isArray(node)) {
    for (const [key, item] of node.entries())
      if (typeof item === "object" && item)
        detectSharedSchemaObjectsIterate(parsed, item, visited, shared, key.toString(), isSchema, `${path}/${encodeJSONReferenceProperty(key.toString())}`);
    return;
  }
  if (keyname !== "properties") {
    if (visited.has(node) && isSchema) {
      shared.add(node);
      return;
    }
    visited.add(node);
  }
  for (const [key, item] of Object.entries(node))
    if (typeof item === "object" && item) {
      detectSharedSchemaObjectsIterate(parsed, item, visited, shared, key, isSchema, `${path}/${encodeJSONReferenceProperty(key.toString())}`);
    }
}

function replaceRefsIterate(node: object, remap: Map<object, { $ref: string }>, stack: Set<object>, path: string, keepRoot: boolean) {
  // Replaced?
  const mapTo = !keepRoot && remap.get(node);
  if (mapTo)
    return mapTo;

  // Detect remaining circular references
  if (stack.has(node)) {
    // this can happen when the heuristics used by detectSharedSchemaObjectsIterate fail. Don't think that's very likely.
    throw new Error(`Detected remaining circular reference`);
  }

  // Iterate through the tree
  stack.add(node);
  if (Array.isArray(node)) {
    for (const [key, item] of node.entries())
      if (typeof item === "object" && item) {
        const retval = replaceRefsIterate(item, remap, stack, `${path}/${encodeJSONReferenceProperty(key.toString())}`, false);
        if (retval)
          node[key] = retval;
      }
  } else {
    for (const [key, item] of Object.entries(node))
      if (typeof item === "object" && item) {
        const retval = replaceRefsIterate(item, remap, stack, `${path}/${encodeJSONReferenceProperty(key.toString())}`, false);
        if (retval)
          (node as Record<string, unknown>)[key] = retval;
      }
  }
  stack.delete(node);
}

export function mergeIntoBundled(data: unknown, merge: unknown, path: string) {
  if (typeof merge !== "object" || !merge || typeof data !== "object" || !data)
    throw new Error(`Cannot merge a non-object into an object`);

  if (Array.isArray(data) !== Array.isArray(merge))
    throw new Error(`Cannot merge array into object or vice versa`);

  for (const [key, value] of Object.entries(merge)) {
    const datavalue = (data as Record<typeof key, unknown>)[key];
    if (typeof value !== "object" || !value)
      (data as Record<typeof key, unknown>)[key] = value;
    else if (typeof datavalue !== "object" || !datavalue)
      (data as Record<typeof key, unknown>)[key] = value;
    else
      mergeIntoBundled((data as Record<typeof key, unknown>)[key], value, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  }
}

export async function createOpenAPITypeDocuments(openapifilepath: string | OpenAPIV3.Document, merge: object | string | undefined, service: OpenAPIDescriptor, importname: string, name: string, isservice: boolean) {
  // First bundle to resolve the references to external files
  const bundled = await SwaggerParser.bundle(openapifilepath) as OpenAPIV3.Document;

  if (merge) {
    const mergeData = typeof merge === "string" ? decodeYAML(await fs.readFile(merge, "utf8")) : merge;
    mergeIntoBundled(bundled, mergeData, "");
  }

  const tag = name.replaceAll(/^[a-z]|_[a-z]/g, c => c.replace("_", "").toUpperCase());

  // Add __internal_format_tag optional keys before validation resolves every $ref reference
  addInternalFormatTags(bundled, bundled, "#");

  /* openapi-typescript doesn't handle references to schemas of a parameter
     correctly, and also miscompiles imports from other files. Using
     .validate will resolve all references (but result in a massive file though)
     ADDME: try to work with typescript-openapi to resolve these issues
     (validate mutates in-place, so use a structured clone)
  */
  const parsed = await SwaggerParser.validate(structuredClone(bundled)) as OpenAPIV3.Document;
  if (!(parsed as OpenAPIV3.Document).openapi?.startsWith("3."))
    throw new Error(`not the right OpenAPI version: got ${JSON.stringify(parsed.openapi)}, wanted 3.x.x`);

  /* openapi-typescripts leaves $defs from the root of imported files as members of the objects defined in the root of
     those files. Because all references have already been resolved, it's safe to remove them.
  */
  recursiveRemoveDefs(parsed, "", new Set<unknown>);

  /* Move all shared schema objects into $defs, breaking circular references that openapi-typescript can't handle and
     making the generated code more compact
  */
  moveSharedSchemaObjects(parsed as OpenAPI3);

  const openapiTSfunc = (await import("openapi-typescript")).default;
  const output = astToString(await openapiTSfunc(parsed as OpenAPI3));

  let result = convertStatusCodes(output);

  const sourcefiles = new Map<string, { symbols: Set<string>; defs: string }>;

  for (const [pathkey, path] of Object.entries(parsed.paths) as [[string, object]]) {
    if (pathkey === "parameters")
      continue;

    const pathfuncname = "check" + pathkey.replace(/[{}]/g, "").split("/").map(e => e.substring(0, 1).toUpperCase() + e.slice(1)).join("");

    const pathfuncaddedfor = new Set<string>;

    for (const [opkey, op] of Object.entries(path) as [[string, object]]) {
      if (opkey === "parameters" || typeof op !== "object")
        continue;
      if ("x-webhare-implementation" in op) {
        const impl = op["x-webhare-implementation"] as string;
        const ref = splitFileReference(impl);
        if (!ref)
          continue;

        const emptydef = { symbols: new Set<string>(), defs: "" };
        const def = sourcefiles.get(ref.file) ?? (sourcefiles.set(ref.file, emptydef) && emptydef);

        if (!pathfuncaddedfor.has(ref.file)) {
          pathfuncaddedfor.add(ref.file);

          def.defs += `\nexport async function ${pathfuncname}(req: TypedRestRequest<APIAuthInfo, ${JSON.stringify(pathkey)}>) {
  // process parameters
  if ("TODO: parameter check failure")
    return { response: req.createErrorResponse(HTTPErrorCode.BadRequest, { error: "bad request" }) };

  return {
    response: null,
    result: "TODO: processed parameter data"
  };
}
`;
        }


        def.symbols.add("TypedRestRequest");

        let sig = `export async function ${ref.name}(req: TypedRestRequest<APIAuthInfo, ${JSON.stringify(`${opkey} ${pathkey}`)}>): Promise<WebResponse> {
  const check = await ${pathfuncname}(req);
  if (check.response)
    return check.response;

  // do operation using check.result
  if (!check.result)
    return req.createErrorResponse(HTTPErrorCode.InternalServerError, { error: "Operation failed" });

  // Type of succesfull response (if multiple responses are possible, add the specific response as the second type parameter)
  const result: RestResponseType<typeof req> = {
    todo: "Response"
  };
`;
        if ("responses" in op) {
          const responses = op.responses as object;
          for (const key of Array.from(Object.keys(responses)).map(k => Number(k))) {
            if (key in HTTPErrorCode) {

              sig += `  if ("error_${HTTPErrorCode[key]}")
    return req.createErrorResponse(HTTPErrorCode.${HTTPErrorCode[key]}, { error: \`Got error ${HTTPErrorCode[key]}\` });
`;
            }
          }

          for (const key of Array.from(Object.keys(responses)).map(k => Number(k))) {
            if (key in HTTPSuccessCode) {
              const v = responses[key as keyof typeof responses] as { content?: { "application/json": unknown } };
              if (v.content?.["application/json"]) {
                sig += `
  return req.createJSONResponse(HTTPSuccessCode.${HTTPSuccessCode[key]}, result);
`;
              } else {
                sig += `
  return req.createRawResponse(HTTPSuccessCode.${HTTPSuccessCode[key]}, "raw response");
`;
              }
              break;
            }
          }
          sig += "}\n";

          def.defs += sig;
        }
      }
    }
  }

  if ("x-webhare-authorization" in parsed) {
    const ref = splitFileReference(parsed["x-webhare-authorization"] as string);
    if (ref) {
      const emptydef = { symbols: new Set<string>(), defs: "" };
      const def = sourcefiles.get(ref.file) ?? (sourcefiles.set(ref.file, emptydef) && emptydef);
      def.symbols.add("TypedRestAuthorizationRequest");

      def.defs =
        `export async function checkBearerToken(req: TypedRestAuthorizationRequest): Promise<RestAuthorizationResult<APIAuthInfo>> {
  throw new Error("TODO check tokens");
}

` + def.defs;
    }
  }

  const signatures = `
/* Signatures and examples:
${Array.from(sourcefiles.entries()).map(([file, def]) => `
## File ${file}

import { HTTPSuccessCode, HTTPErrorCode, RestAuthorizationResult, RestResponseType, WebResponse } from "@webhare/router";
import { ${Array.from(def.symbols).sort().join(", ")} } from ${JSON.stringify(importname)};


type APIAuthInfo = null;

` + def.defs).join("\n")}*/
`;


  const clientname = `OpenAPI${tag}Client`;

  result = `/* eslint-disable @typescript-eslint/no-explicit-any -- used in helper functions emitted by openapi-typescript */
/* eslint-disable @typescript-eslint/array-type -- openapi-typescript doesn't follow the WebHare convention */
/* eslint-disable no-tabs -- don't care about tabs from source files */

${isservice ? `import type { OperationIds, OpenApiTypedRestAuthorizationRequest, OpenApiTypedRestRequest } from "@mod-system/js/internal/openapi/types";
` : ``}import type { HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import { TypedOpenAPIClient, type TypedClientRequestBody, type TypedClientResponse, type GetClientTypeParams, type PathsForMethod } from "@mod-system/js/internal/openapi/openapitypedclient";

${result}

/** API client class for this API.
 */
export class ${clientname} extends TypedOpenAPIClient<paths, components> {
  /* no extra props yet */
}

/** Type of the request body for a specific API call
 */
export type ${clientname}RequestBody<
  Method extends "get" | "post" | "patch" | "put" | "delete",
  MethodPath extends PathsForMethod<GetClientTypeParams<${clientname}>["paths"], Method>
> = TypedClientRequestBody<${clientname}, Method, MethodPath>;

export type ${clientname}Response<
  Method extends "get" | "post" | "patch" | "put" | "delete",
  MethodPath extends PathsForMethod<GetClientTypeParams<${clientname}>["paths"], Method>
> = TypedClientResponse<${clientname}, Method, MethodPath>;
`;
  if (isservice)
    result += `
/** Type with the possible operations, in the form of \`\${method} \${path}\`
 */
export type DeclaredOperations = OperationIds<paths>;

/** Type to use for the RestRequest when implementing an operation (or function for all operations of a path). In the latter case,
 * access to success responses and the body is restricted when these differ between the operations.
 * @typeParam Auth - Format of authorization data
 * @typeParam OperationId - Operation id, eg "get /path" or "/path" for all operations of that path
 */
export type TypedRestRequest<Auth, OperationId extends DeclaredOperations> = OpenApiTypedRestRequest<Auth, paths, components, OperationId>;

/** Type to use for the RestRequest when implementing an authentication function.
 */
export type TypedRestAuthorizationRequest = OpenApiTypedRestAuthorizationRequest<paths, components>;
` + signatures;

  return result;
}

async function generateFile(options: GenerateContext, service: OpenAPIDescriptor, module: string, name: string, isservice: boolean) {
  const importname = whconstant_builtinmodules.includes(module)
    ? `modules/platform/generated/openapi/${module}/${name}`
    : `wh:openapi/${module}/${name}`;

  const timername = `Generating OpenAPI ${module}:${name}`;
  if (options.verbose)
    console.time(timername);

  const retval = await createOpenAPITypeDocuments(toFSPath(service.spec), service.merge && toFSPath(service.merge), service, importname, name, isservice);
  if (options.verbose)
    console.timeEnd(timername);

  return retval;
}

function getFilesForModules(module: string, processmodules: string[]): FileToUpdate[] {
  const retval: FileToUpdate[] = [];
  const serviceconfig = getExtractedConfig("services");
  //FIXME as client and services use separate XML nodes but build the same name, who prevents a clash?
  const openapis = [
    ...serviceconfig.openAPIClients.map(_ => ({ ..._, isservice: false })),
    ...serviceconfig.openAPIServices.map(_ => ({ ..._, isservice: true }))
  ].filter(_ => processmodules.some(m => _.name.startsWith(m + ":")));
  for (const item of openapis) {
    const [modulename, name] = item.name.split(":");
    retval.push({
      type: "openapi",
      path: "openapi/" + module + "/" + name + ".ts",
      module,
      generator: (context: GenerateContext) => generateFile(context, item, modulename, name, item.isservice)
    });
  }

  return retval;
}

export async function listAllModuleOpenAPIDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));
  const files = getFilesForModules("platform", whconstant_builtinmodules);
  for (const mod of noncoremodules)
    files.push(...getFilesForModules(mod, [mod]));
  return files;
}
