import SwaggerParser from "@apidevtools/swagger-parser";
import { createJSONResponse, HTTPErrorCode, WebRequest, DefaultRestParams, RestRequest, WebResponse, HTTPMethod, RestAuthorizationFunction, RestImplementationFunction, HTTPSuccessCode } from "@webhare/router";
import Ajv2020, { ValidateFunction, ErrorObject, SchemaObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { OpenAPIV3 } from "openapi-types";
import { resolveResource, toFSPath } from "@webhare/services";
import { LoggableRecord } from "@webhare/services/src/logmessages";
import { loadJSFunction } from "../resourcetools";
import { config } from "@mod-system/js/internal/configuration";
import { CodeContext } from "@webhare/services/src/codecontexts";

const SupportedMethods: HTTPMethod[] = [HTTPMethod.GET, HTTPMethod.PUT, HTTPMethod.POST, HTTPMethod.DELETE, HTTPMethod.OPTIONS, HTTPMethod.HEAD, HTTPMethod.PATCH];

interface Operation {
  // The function to call
  handler: string | null;
  // All parameters for the operation (path(route) and operation level)
  params: OpenAPIV3.ParameterObject[];
  // Body parameter
  requestBody: OpenAPIV3.RequestBodyObject | null;
  // Authorization callback
  authorization: string | null;
  // Responses
  responses: OpenAPIV3.ResponsesObject;
}

interface Route {
  // The path parts, e.g. ["users", "{userid}", "tokens"]
  path: string[];
  // The path-parameters to gather on this route
  params: OpenAPIV3.ParameterObject[];
  // Supported methods
  methods: Partial<Record<HTTPMethod, Operation>>;
}

type Match = { route: Route; params: Record<string, string> };

interface WHOperationAddition {
  "x-webhare-implementation"?: string;
  "x-webhare-authorization"?: string;
}

interface WHOpenAPIPathItem extends OpenAPIV3.PathItemObject<WHOperationAddition> {
  "x-webhare-authorization"?: string;
}

interface WHOpenAPIDocument extends OpenAPIV3.Document<WHOperationAddition> {
  "x-webhare-authorization"?: string;
}

function filterXWebHare(def: unknown): unknown {
  if (!def || typeof def !== "object")
    return def;
  if (Array.isArray(def)) {
    return def.map(item => filterXWebHare(item));
  }
  const filtered: { [key: string]: unknown } = {};
  for (const key of Object.keys(def))
    if (!key.startsWith("x-webhare-"))
      filtered[key] = filterXWebHare((def as { [key: string]: unknown })[key]);
  return filtered;
}

//  Match a request path with a route path, part by part, storing {parameters} in the request
function matchesPath(path: string[], routePath: string[], req: WebRequest): Record<string, string> | null {
  const rpl = routePath.length;
  if (path.length != rpl)
    return null;

  const params: Record<string, string> = {};
  for (let i = 0, pl = path.length; i < pl; ++i) {
    if (i >= rpl)
      return null;
    if (routePath[i].startsWith("{") && routePath[i].endsWith("}"))
      params[routePath[i].substring(1, routePath[i].length - 1)] = path[i];
    else if (path[i] != routePath[i])
      return null;
  }

  return params;
}

function createErrorResponse(status: HTTPErrorCode, json: { error: string; status?: never }, options?: { headers?: Record<string, string> }) {
  return createJSONResponse(status, { status, ...json }, options);
}

function formatAjvError(errors: ErrorObject[]): string {
  /* The error looks like this:
  >   {
        instancePath: '',
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'email' },
        message: "must have required property 'email'"
      }
      so we might be able to use it to generate a more useful error message ?
  */
  const error = errors?.[0];
  const params = Object.entries(error.params).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
  return `${error.message ?? "invalid value"}${params ? ` (${params})` : ``}${(error?.instancePath ? ` (at ${JSON.stringify(error?.instancePath)})` : "")}`;
}

export class LogInfo {
  start = performance.now();
  route: string = '';
  method: string;
  sourceip: string;
  timings: Record<string, number> = {};
  authorized?: LoggableRecord;

  constructor(sourceip: string, method: string) {
    this.sourceip = sourceip;
    this.method = method;
  }
}

// An OpenAPI handler
export class RestAPI {
  _ajv: Ajv2020 | null = null;
  bundled: WHOpenAPIDocument | null = null;
  def: WHOpenAPIDocument | null = null;
  _validators = new Map<object, ValidateFunction>;

  // Get the JSON schema validator singleton
  protected get ajv() {
    if (!this._ajv) {
      this._ajv = new Ajv2020({ allowMatchingProperties: true });
      addFormats(this._ajv);
    }
    return this._ajv;
  }

  private routes: Route[] = [];

  async init(def: object, specresourcepath: string) {
    // Bundle all external files into one document
    const bundled = await SwaggerParser.bundle(toFSPath(specresourcepath), def as WHOpenAPIDocument, {});
    // Parse the OpenAPI definition. Make a structured clone of bundled, because validate modifies the incoming data
    const parsed = await SwaggerParser.validate(structuredClone(bundled));
    if (!(parsed as OpenAPIV3.Document).openapi?.startsWith("3."))
      throw new Error(`Unsupported OpenAPI version ${parsed.info.version}`);

    // Save the bundled document for openapi.json output
    this.bundled = bundled as WHOpenAPIDocument;

    /* Per https://apitools.dev/swagger-parser/docs/swagger-parser.html#validateapi-options-callbac
       "This method calls dereference internally, so the returned Swagger object is fully dereferenced."
       we shouldn't be seeing any more OpenAPIV3.ReferenceObject objects anymore. TypeScript does'nt know this
       so we need a few cast below to build the routes ...*/
    this.def = parsed as WHOpenAPIDocument;
    const toplevel_authorization = this.def["x-webhare-authorization"] ? resolveResource(specresourcepath, this.def["x-webhare-authorization"]) : null;

    // FIXME we can still do some more preprocessing? (eg body validation compiling and resolving x-webhare-implementation)
    // Read the API paths
    if (this.def!.paths) {
      // path is a string, e.g. "/users/{userid}/tokens"
      for (const path of Object.keys(this.def.paths)) {
        // comp is an object with keys for each supported method
        const comp = this.def.paths[path]! as WHOpenAPIPathItem;
        const routepath = path.split('/');
        const path_authorization = comp["x-webhare-authorization"] ? resolveResource(specresourcepath, comp["x-webhare-authorization"]) : toplevel_authorization;

        const route: Route = {
          path: routepath,
          params: (comp.parameters as OpenAPIV3.ParameterObject[])?.filter(p => p.in === "path"),
          methods: {}
        };

        for (const method of SupportedMethods) {
          const operation = comp[method];
          if (operation) {
            const handler = operation["x-webhare-implementation"] ? resolveResource(specresourcepath, operation["x-webhare-implementation"]) : null;
            const operation_authorization = operation["x-webhare-authorization"] ? resolveResource(specresourcepath, operation["x-webhare-authorization"]) : path_authorization;
            const params = [];
            if (comp.parameters)
              params.push(...comp.parameters as OpenAPIV3.ParameterObject[]);
            if (operation.parameters)
              params.push(...operation.parameters as OpenAPIV3.ParameterObject[]);

            route.methods[method] = {
              params,
              handler,
              requestBody: operation.requestBody as OpenAPIV3.RequestBodyObject | null,
              authorization: operation_authorization,
              responses: operation.responses
            };
          }
        }
        this.routes.push(route);
      }
    }
  }

  private getValidator(schema: object): ValidateFunction {
    let res = this._validators.get(schema);
    if (res)
      return res;
    res = this.ajv.compile(schema);
    this._validators.set(schema, res);
    return res;
  }

  findRoute(relurl: string, req: WebRequest): Match | null {
    const path = relurl.split("/");
    for (const route of this.routes) {
      const params = matchesPath(path, route.path, req);
      if (params) //it's a match, and we parsed the params while we're at it..
        return { route: route, params };
    }
    return null;
  }

  async handleRequest(req: WebRequest, relurl: string, logger: LogInfo): Promise<WebResponse> {
    if (!this.def) //TODO with 'etr' return validation issues
      return createErrorResponse(HTTPErrorCode.InternalServerError, { error: `Service not configured` });

    // Find the route matching the request path
    const match = this.findRoute(relurl, req);
    if (!match)
      return createErrorResponse(HTTPErrorCode.NotFound, { error: `No route for '${relurl}'` });

    logger.route = match.route.path.join("/");

    const endpoint = match.route.methods[req.method];
    if (!endpoint)
      return createErrorResponse(HTTPErrorCode.MethodNotAllowed, { error: `Method ${req.method.toUpperCase()} not allowed for path '${relurl}'` });
    if (!endpoint.authorization) //TODO with 'etr' return more about 'why'
      return createErrorResponse(HTTPErrorCode.Forbidden, { error: `Not authorized` });

    const response = await this.handleEndpointRequest(req, relurl, match, endpoint, logger);

    if (["development", "test"].includes(config.dtapstage)) {
      // ADDME: add flag to disable for performance testing

      // Check if response is listed
      if (response.status.toString() in endpoint.responses || (response.status in HTTPErrorCode && this.def?.components?.schemas?.defaulterror)) {
        let responseschema;
        if (response.status.toString() in endpoint.responses) {
          const responsedef = endpoint.responses[response.status] as OpenAPIV3.ResponseObject;
          responseschema = responsedef?.content?.["application/json"]?.schema;
        }
        // Fallback to 'defaulterror' for errors, if specified in components.schemas
        if (!responseschema && response.status in HTTPErrorCode && this.def?.components?.schemas?.defaulterror) {
          responseschema = this.def.components.schemas.defaulterror;
        }
        if (responseschema) {
          const start = performance.now();
          const validator = this.getValidator(responseschema);
          const success = validator(await response.json());
          // eslint-disable-next-line require-atomic-updates
          logger.timings.responsevalidation = performance.now() - start;

          if (!success) {
            throw new Error(`Validation of the response (code ${response.status}) for ${JSON.stringify(`${req.method} ${relurl}`)} returned error: ${formatAjvError(validator.errors ?? [])}`);
          }
        }
      } else if (!(response.status in HTTPErrorCode)) {
        // ADDME:
        throw new Error(`Handler returned status code ${response.status} which is not mentioned for path ${JSON.stringify(`${req.method} ${relurl}`)}`);
      }
    }

    return response;
  }

  async handleEndpointRequest(req: WebRequest, relurl: string, match: Match, endpoint: Operation, logger: LogInfo): Promise<WebResponse> {
    if (!endpoint.authorization)
      throw new Error(`Got an endpoint without authorisation settings`); // should be filtered out before this function

    // Build parameters (eg. from the path or from the query)
    const params: DefaultRestParams = {};
    logger.timings.validation = 0;

    if (endpoint.params)
      for (const param of endpoint.params) {
        let paramvalue: string | number | boolean | null = null;
        if (param.in === "path") { //we already extracted path parameters during matching:
          paramvalue = decodeURIComponent(match.params[param.name]);
        } else if (param.in === "query") {
          if (req.url.searchParams.has(param.name))
            paramvalue = req.url.searchParams.get(param.name);
          else if (param.required)
            return createErrorResponse(HTTPErrorCode.BadRequest, { error: `Missing required parameter ${param.name}}` });
        } else {
          throw new Error(`Unsupported parameter location '${param.in}'`);
        }

        if (paramvalue === null)
          continue; //Unspecified parameter (TODO do we need to support default values?)

        if (param.schema) {
          if ("type" in param.schema) {
            // We'll only convert 'number' and 'boolean' parameters, other parameters will be supplied as strings
            if (param.schema.type === "number" && !isNaN(Number(paramvalue)))
              paramvalue = Number(paramvalue);
            if (param.schema.type === "boolean")
              paramvalue = paramvalue === "1" || paramvalue === "true";
          }

          const start = performance.now();
          const validator = this.getValidator(param.schema as SchemaObject);
          const success = validator(paramvalue);
          logger.timings.validation += performance.now() - start;

          if (!success)
            return createErrorResponse(HTTPErrorCode.BadRequest, { error: `Invalid parameter ${param.name}: ${formatAjvError(validator.errors ?? [])}` });
        }

        params[param.name] = paramvalue;
      }

    let body = null;
    const bodyschema = endpoint.requestBody?.content["application/json"]?.schema;
    if (bodyschema) {
      //We have something useful to proces
      const ctype = req.headers.get("content-type");
      if (ctype != "application/json") //TODO what about endpoints supporting multiple types?
        return createErrorResponse(HTTPErrorCode.BadRequest, { error: `Invalid content-type '${ctype}', expected application/json` });

      try {
        body = await req.json();
      } catch (e) { //parse error. There's no harm in 'leaking' a JSON parse error details
        return createErrorResponse(HTTPErrorCode.BadRequest, { error: `Failed to parse the body: ${(e as Error)?.message}` });
      }

      // Validate the incoming request body (TODO cache validators, prevent parallel compilation when a lot of requests come in before we finished compilation)
      const start = performance.now();
      const validator = this.getValidator(bodyschema);
      const success = validator(body);
      logger.timings.validation += performance.now() - start;

      if (!success) {
        return createErrorResponse(HTTPErrorCode.BadRequest, { error: `Invalid request body: ${formatAjvError(validator.errors ?? [])}` });
      }
    }

    // Create the request object
    const restreq = new RestRequest(req, relurl, params, body);

    let authresult;
    {
      const start = performance.now();
      const authcontext = new CodeContext("openapi", {
        fase: "authorization",
        url: req.url.toString(),
        path: match.route.path.join("/"),
        relurl,
      });

      try {
        // Load the authorizer outside of the code context, so the loaded library won't inherit the context of the first caller
        const authorizationfunction = endpoint.authorization;
        const authorizer = (await loadJSFunction(authorizationfunction)) as RestAuthorizationFunction;

        authresult = await authcontext.run(async () => {
          // Run the authorizer first
          return authorizer(restreq);
        });
        if (!authresult.authorized)
          return authresult.response || createErrorResponse(HTTPErrorCode.Unauthorized, { error: "Authorization is required for this endpoint" });
        else if (authresult.loginfo)
          // eslint-disable-next-line require-atomic-updates
          logger.authorized = authresult.loginfo;
      } finally {
        authcontext.close();
        // eslint-disable-next-line require-atomic-updates
        logger.timings.authorization = performance.now() - start;
      }
    }
    //FIXME merge autohrization info into loginfo
    restreq.authorization = authresult.authorization;
    if (!endpoint.handler)
      return createErrorResponse(HTTPErrorCode.NotImplemented, { error: `Method ${req.method.toUpperCase()} for route '${relurl}' not yet implemented` });

    {
      const start = performance.now();
      const handlercontext = new CodeContext("openapi", {
        fase: "handler",
        url: req.url.toString(),
        path: match.route.path.join("/"),
        relurl,
      });

      try {
        // Load the handler outside of the code context, so the loaded library won't inherit the context of the first caller
        const handler = endpoint.handler;

        // FIXME should we cache the resolved handler or will that break auto reloading?
        const resthandler = (await loadJSFunction(handler)) as RestImplementationFunction;

        // Need to await here, otherwise handlercontext.close will run immediately
        return await handlercontext.run(async () => {
          // FIXME timeouts
          // Handle it!
          return resthandler(restreq);
        });
      } finally {
        handlercontext.close();
        // eslint-disable-next-line require-atomic-updates
        logger.timings.handling = performance.now() - start;
      }
    }
  }

  renderOpenAPIJSON(baseurl: string, options: { filterxwebhare: boolean; indent?: boolean }): WebResponse {
    let def = { ...this.bundled };
    if (options.filterxwebhare)
      def = filterXWebHare(def) as typeof def;

    if (!this.def)
      return createErrorResponse(HTTPErrorCode.InternalServerError, { error: `Service not configured` });

    if (def.servers)
      for (const server of def.servers)
        if (server.url)
          server.url = new URL(server.url, baseurl).toString();

    return createJSONResponse(HTTPSuccessCode.Ok, def, { indent: options.indent });
  }
}
