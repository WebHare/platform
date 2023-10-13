import fs from "node:fs";
import { config } from "../configuration";
import { whconstant_builtinmodules } from "../webhareconstants";
import { FileToUpdate, GenerateOptions } from "./shared";
import * as services from "@webhare/services";
import type { Readable } from "node:stream";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPI3, OpenAPITSOptions } from "openapi-typescript";
import { OpenAPIV3 } from "openapi-types";
import { HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import { splitFileReference } from "@webhare/services/src/naming";
import { XMLParser } from "fast-xml-parser";


/** This scripts create typescript type definitions from the OpenAPI specification for APIs
 * In the component imports for the document types, it will add an optional member __internal_format_tag,
 * that ensures no data is mixed up between input, database and output without going through conversion.
 */

type OpenAPIService = {
  module: string;
  name: string;
  spec: string;
  isservice: boolean;
};

function convertStatusCodes(result: string) {
  return result.split("\n").map(line => {
    const match = /^( {8})(\d\d\d)(.*)$/.exec(line);
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
  return encodeURIComponent(prop.replace(/~/g, '~0').replace(/\//g, '~1'));
}

function findJSONReference(root: unknown, prop: string) {
  if (!prop.startsWith("#/")) {
    return null;
  }
  const parts = prop.slice(2).split("/").map(p => decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~"));
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

export async function createOpenAPITypeDocuments(openapifilepath: string, service: OpenAPIService, importname: string) {
  // First bundle to resolve the references to external files
  const bundled = await SwaggerParser.bundle(openapifilepath) as OpenAPIV3.Document;

  const tag = service.name.replaceAll(/^[a-z]|_[a-z]/g, c => c.replace("_", "").toUpperCase());

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

  type OpenAPITS = (schema: string | URL | OpenAPI3 | Readable, options?: OpenAPITSOptions) => Promise<string>;
  const openapiTSfunc = (await import("openapi-typescript")).default as OpenAPITS;
  const output = await openapiTSfunc(parsed as OpenAPI3);

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

  result = `/* eslint-disable tsdoc/syntax -- openapi-typescript emits jsdoc, not tsdoc */
/* eslint-disable @typescript-eslint/no-explicit-any -- used in helper functions emitted by openapi-typescript */
/* eslint-disable @typescript-eslint/array-type -- openapi-typescript doesn't follow the WebHare convention */

${service.isservice ? `import { OperationIds, OpenApiTypedRestAuthorizationRequest, OpenApiTypedRestRequest } from "@mod-system/js/internal/openapi/types";
` : ``}import { HTTPErrorCode, HTTPSuccessCode } from "@webhare/router";
import { TypedOpenAPIClient, TypedClientRequestBody, TypedClientResponse, GetClientTypeParams, PathsForMethod } from "@mod-system/js/internal/openapi/openapitypedclient";

/* If you get an error in this file that says that components doesn't extend from ComponentsBase, make sure that your
 * components.schemas.defaulterror object extends from \`{ error: string; status: number }\`.
*/

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
  if (service.isservice)
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

function getOpenAPIServicesOfModule(module: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["openapiservice", "openapiclient"].includes(name)
  });

  const retval: OpenAPIService[] = [];
  try {
    const moduledefresource = `mod::${module}/moduledefinition.xml`;
    const parsedmodule = parser.parse(fs.readFileSync(services.toFSPath(moduledefresource)));
    for (const service of parsedmodule.module.services?.openapiservice ?? []) {
      try {
        retval.push({
          module,
          name: service["@name"],
          spec: services.toFSPath(services.resolveResource(moduledefresource, service["@spec"])),
          isservice: true
        });
      } catch (e) {
        console.error(`Error resolving spec of openapi service ${module}:${service["@name"]}:`, e);
        services.logError(e as Error);
      }
    }
    for (const service of parsedmodule.module.services?.openapiclient ?? []) {
      try {
        if (retval.find(r => r.name === service["@name"]))
          continue;
        retval.push({
          module,
          name: service["@name"],
          spec: services.toFSPath(services.resolveResource(moduledefresource, service["@spec"])),
          isservice: false
        });
      } catch (e) {
        console.error(`Error resolving spec of openapi service ${module}:${service["@name"]}:`, e);
        services.logError(e as Error);
      }
    }
  } catch (e) {
    console.error(`Error parsing moduledefinition of ${module}`, e);
    services.logError(e as Error);
  }
  return retval;
}

async function generateFile(options: GenerateOptions, service: OpenAPIService) {
  const importname = whconstant_builtinmodules.includes(service.module)
    ? `modules/system/js/internal/generated/openapi/${service.module}/${service.name}`
    : `wh:openapi/${service.module}/${service.name}`;

  const timername = `Generating OpenAPI ${service.module}:${service.name}`;
  if (options.verbose)
    console.time(timername);

  const retval = await createOpenAPITypeDocuments(service.spec, service, importname);
  if (options.verbose)
    console.timeEnd(timername);

  return retval;
}

function getFilesForModules(module: string, processmodules: string[]): FileToUpdate[] {
  const retval: FileToUpdate[] = [];
  for (const processmodule of processmodules)
    for (const item of config.module[module] ? getOpenAPIServicesOfModule(processmodule) : [])
      retval.push({
        type: "openapi",
        path: "openapi/" + processmodule + "/" + item.name + ".ts",
        module,
        generator: (options) => generateFile(options, item)
      });

  return retval;
}

export async function listAllModuleOpenAPIDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(config.module).filter(m => !whconstant_builtinmodules.includes(m));
  const files = getFilesForModules("platform", whconstant_builtinmodules);
  for (const mod of noncoremodules)
    files.push(...getFilesForModules(mod, [mod]));
  return files;
}
