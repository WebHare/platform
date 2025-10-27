import SwaggerParser from "@apidevtools/swagger-parser";
import { createJSONResponse, HTTPErrorCode, type WebRequest, type DefaultRestParams, RestRequest, type WebResponse, HTTPMethod, type RestAuthorizationFunction, type RestImplementationFunction, HTTPSuccessCode, type OpenAPIServiceInitializationContext, type WebHareOpenAPIDocument, type RestDefaultErrorMapperFunction } from "@webhare/router";
import Ajv2020, { type ValidateFunction, type ErrorObject, type SchemaObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";
import { importJSFunction, resolveResource } from "@webhare/services";
import type { LoggableRecord } from "@webhare/services/src/logmessages";
import { backendConfig } from "@mod-system/js/internal/configuration";
import { CodeContext } from "@webhare/services/src/codecontexts";
import type { AsyncWorker } from "../worker";
import { type WebRequestTransferData, createWebRequestFromTransferData } from "@webhare/router/src/request";
import { type WebResponseForTransfer, createWebResponseFromTransferData } from "@webhare/router/src/response";
import { type ConvertLocalServiceInterfaceToClientInterface, type ReturnValueWithTransferList, createReturnValueWithTransferList } from "@webhare/services/src/localservice";
import { RestAPIWorkerPool } from "./workerpool";
import type { OpenAPIValidationMode } from "../generation/gen_extracts";
import type { OpenAPIHandlerInitializationContext, WebHareOpenApiPathItem } from "@webhare/router/src/openapi";

export type OpenAPIInitHookFunction = (context: OpenAPIServiceInitializationContext) => Promise<void | { signal?: AbortSignal }> | void | { signal?: AbortSignal };

export type OpenAPIInitHandlerHookFunction = (context: OpenAPIHandlerInitializationContext) => Promise<void> | void;

const SupportedMethods: HTTPMethod[] = [HTTPMethod.GET, HTTPMethod.PUT, HTTPMethod.POST, HTTPMethod.DELETE, HTTPMethod.OPTIONS, HTTPMethod.HEAD, HTTPMethod.PATCH];

function resolveJSResource(base: string, relativepath: string) {
  //Needed to understand @mod- paths. See https://gitlab.webhare.com/webharebv/codekloppers/-/issues/1069#note_225871
  return relativepath.startsWith("@mod-") ? relativepath : resolveResource(base, relativepath);
}


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
  /// When should the input be validated
  inputValidation: OpenAPIValidationMode | null;
  /// When should the output be validated
  outputValidation: OpenAPIValidationMode | null;
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
  if (path.length !== rpl)
    return null;

  const params: Record<string, string> = {};
  for (let i = 0, pl = path.length; i < pl; ++i) {
    if (i >= rpl)
      return null;
    if (routePath[i].startsWith("{") && routePath[i].endsWith("}"))
      params[routePath[i].substring(1, routePath[i].length - 1)] = path[i];
    else if (path[i] !== routePath[i])
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

const defaultMaxOpenAPIWorkers = 5;
const defaultMaxCallsPerOpenAPIWorkers = 100;
const maxOpenAPIWorkers = parseInt(process.env.WEBHARE_OPENAPI_WORKERS || "") || defaultMaxOpenAPIWorkers;
const maxCallsPerWorker = parseInt(process.env.WEBHARE_OPENAPI_WORKERS_MAXCALLS || "") || defaultMaxCallsPerOpenAPIWorkers;

type Handler = ConvertLocalServiceInterfaceToClientInterface<WorkerRestAPIHandler>;

export function renderOpenAPIJSON(def: WebHareOpenAPIDocument, baseurl: string, options: { filterxwebhare: boolean; indent?: boolean }): WebResponse {
  if (options.filterxwebhare)
    def = filterXWebHare(def) as typeof def;

  if (def.servers) { //rewrite to absolute URLs
    def = { ...def, servers: structuredClone(def.servers) };
    for (const server of def.servers!)
      if (server.url)
        server.url = new URL(server.url, baseurl).toString();
  }

  return createJSONResponse(HTTPSuccessCode.Ok, def, { indent: options.indent });
}

// An OpenAPI handler
export class RestAPI {
  serviceName!: string;
  def: WebHareOpenAPIDocument | null = null;
  private routes: Route[] = [];
  private workerPool = new RestAPIWorkerPool("restapi", maxOpenAPIWorkers, maxCallsPerWorker);
  handlers = new WeakMap<AsyncWorker, Handler>();
  inputValidation: OpenAPIValidationMode | null = null;
  outputValidation: OpenAPIValidationMode | null = null;
  crossdomainOrigins: string[] = [];
  handlerInitHook: string | null = null;
  defaultErrorMapper: string | null = null;
  swaggerOptions: object = {};

  constructor(public bundled: WebHareOpenAPIDocument) {
  }

  async init(specresourcepath: string, { name, merge, inputValidation, outputValidation, crossdomainOrigins, initHook, handlerInitHook, swaggerOptions }: { name: string; merge?: object; inputValidation?: OpenAPIValidationMode; outputValidation?: OpenAPIValidationMode; crossdomainOrigins?: string[]; initHook?: string; handlerInitHook?: string; swaggerOptions: object }) {
    this.serviceName = name;
    this.inputValidation = inputValidation || null;
    this.outputValidation = outputValidation || null;
    this.handlerInitHook = handlerInitHook ?? null;
    this.swaggerOptions = swaggerOptions;
    if (crossdomainOrigins)
      this.crossdomainOrigins = crossdomainOrigins;

    // Parse the OpenAPI definition. Make a structured clone of bundled, because validate modifies the incoming data
    this.def = await SwaggerParser.validate(structuredClone(this.bundled)) as WebHareOpenAPIDocument;
    if (!this.def.openapi?.startsWith("3."))
      throw new Error(`Unsupported OpenAPI version ${this.def.info.version}`);

    /* Per https://apitools.dev/swagger-parser/docs/swagger-parser.html#validateapi-options-callbac
       "This method calls dereference internally, so the returned Swagger object is fully dereferenced."
       we shouldn't be seeing any more OpenAPIV3.ReferenceObject objects anymore. TypeScript doesn't know this
       so we need a few cast below to build the routes ...*/
    const toplevel_authorization = this.def["x-webhare-authorization"] ? resolveJSResource(specresourcepath, this.def["x-webhare-authorization"]) : null;

    if (this.def["x-webhare-default-error-mapper"])
      this.defaultErrorMapper = resolveJSResource(specresourcepath, this.def["x-webhare-default-error-mapper"]);

    // FIXME we can still do some more preprocessing? (eg body validation compiling and resolving x-webhare-implementation)
    // Read the API paths
    if (this.def!.paths) {
      // path is a string, e.g. "/users/{userid}/tokens"
      for (const path of Object.keys(this.def.paths)) {
        // comp is an object with keys for each supported method
        const comp = this.def.paths[path]! as WebHareOpenApiPathItem;
        const routepath = path.split('/');
        const path_authorization = comp["x-webhare-authorization"] ? resolveJSResource(specresourcepath, comp["x-webhare-authorization"]) : toplevel_authorization;

        const route: Route = {
          path: routepath,
          params: (comp.parameters as OpenAPIV3.ParameterObject[])?.filter(p => p.in === "path"),
          methods: {}
        };

        for (const method of SupportedMethods) {
          const operation = comp[method.toLowerCase() as OpenAPIV3.HttpMethods];
          if (operation) {
            const handler = operation["x-webhare-implementation"] ? resolveJSResource(specresourcepath, operation["x-webhare-implementation"]) : null;
            const operation_authorization = operation["x-webhare-authorization"] ? resolveJSResource(specresourcepath, operation["x-webhare-authorization"]) : path_authorization;
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
              responses: operation.responses,
              inputValidation: this.inputValidation,
              outputValidation: this.outputValidation,
            };
          }
        }
        this.routes.push(route);
      }
    }
  }

  async handleRequest(req: WebRequest, relurl: string, logger: LogInfo): Promise<WebResponse> {
    if (!this.def) //TODO with 'etr' return validation issues
      return createErrorResponse(HTTPErrorCode.InternalServerError, { error: `Service not configured` });

    const res = await this.workerPool.runInWorker(async worker => {
      // Get the handler for this worker
      let workerHandler = this.handlers.get(worker);
      if (!workerHandler) {
        this.handlers.set(worker, workerHandler = await worker.callFactory<Handler>("@mod-system/js/internal/openapi/restapi.ts#getWorkerRestAPIHandler", this.serviceName, this.routes, this.def?.components?.schemas?.defaulterror ?? null, this.defaultErrorMapper, this.handlerInitHook));
      }
      const encodedTransfer = req.encodeForTransfer();
      return await workerHandler.handleRequest.callWithTransferList(encodedTransfer.transferList, encodedTransfer.value, relurl, logger);
    });

    Object.assign(logger, res.logger);
    return createWebResponseFromTransferData(res.response);
  }

  renderOpenAPIJSON(baseurl: string, options: { filterxwebhare: boolean; indent?: boolean }): WebResponse {
    return renderOpenAPIJSON(this.bundled, baseurl, options);
  }

  [Symbol.dispose]() {
    this.workerPool.close();
  }
}

function createAjvValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allowMatchingProperties: true });
  addFormats(ajv);
  // Allow keyword 'example'
  ajv.addVocabulary(["example"]);
  return ajv;
}

export class WorkerRestAPIHandler {
  serviceName: string;
  ajv: Ajv2020 = createAjvValidator();
  validators = new Map<object, ValidateFunction>;
  routes: Route[];
  defaultErrorSchema: SchemaObject | null;
  defaultErrorMapper: string;
  handlerInitHook: string | null;
  calledHandlerInitHook: Promise<void> | null = null;

  constructor(serviceName: string, routes: Route[], defaultErrorSchema: SchemaObject | null, defaultErrorMapper: string, handlerInitHook: string | null) {
    this.serviceName = serviceName;
    this.routes = routes;
    this.defaultErrorSchema = defaultErrorSchema;
    this.defaultErrorMapper = defaultErrorMapper;
    this.handlerInitHook = handlerInitHook;
  }

  /// Build error responses for errors other than operation result errors (method not found, validation failures, etc)
  private async buildErrorResponse(status: HTTPErrorCode, error: string): Promise<WebResponse> {
    if (this.defaultErrorMapper) {
      const mapperFunction = await importJSFunction<RestDefaultErrorMapperFunction>(this.defaultErrorMapper);
      return mapperFunction({ status, error });
    }
    return createJSONResponse(status, { status, error });
  }

  private shouldValidate(mode: OpenAPIValidationMode | null, defaultMode: OpenAPIValidationMode) {
    const checkMode = mode ?? defaultMode;
    return checkMode[0] === "always" || checkMode.some(item => item === backendConfig.dtapstage);
  }

  private async ensureHandlerInit() {
    const handlerInitHook = this.handlerInitHook;
    if (handlerInitHook) {
      await (this.calledHandlerInitHook ??= (async () => {
        const initFunction = await importJSFunction<OpenAPIInitHandlerHookFunction>(handlerInitHook!);
        await initFunction({ name: this.serviceName, ajv: this.ajv });
      })());
    }
  }

  private getValidator(schema: object): ValidateFunction {
    let res = this.validators.get(schema);
    if (res)
      return res;
    res = this.ajv.compile(schema);
    this.validators.set(schema, res);
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

  async handleRequest(reqTransferData: WebRequestTransferData, relurl: string, logger: LogInfo): Promise<ReturnValueWithTransferList<{ response: WebResponseForTransfer; logger: LogInfo }>> {
    const res = await this.handleRequestInternal(reqTransferData, relurl, logger);
    const encoded = await res.encodeForTransfer(); //TODO should be freestanding API? only user and keep a pretty internal encoding out of the API
    return createReturnValueWithTransferList({ response: encoded.value, logger }, encoded.transferList);
  }

  async handleRequestInternal(reqTransferData: WebRequestTransferData, relurl: string, logger: LogInfo): Promise<WebResponse> {
    const req = createWebRequestFromTransferData(reqTransferData);
    // Find the route matching the request path
    const match = this.findRoute(relurl, req);
    if (!match)
      return await this.buildErrorResponse(HTTPErrorCode.NotFound, `No route for '${relurl}'`);

    await this.ensureHandlerInit();

    logger.route = match.route.path.join("/");

    const endpoint = match.route.methods[req.method];
    if (!endpoint)
      return this.buildErrorResponse(HTTPErrorCode.MethodNotAllowed, `Method ${req.method.toUpperCase()} not allowed for path '${relurl}'`);
    if (!endpoint.authorization) //TODO with 'etr' return more about 'why'
      return this.buildErrorResponse(HTTPErrorCode.Forbidden, `Not authorized`);

    const response = await this.handleEndpointRequest(req, relurl, match, endpoint, logger);

    // Default to validating the output on dtap stages test and development
    if (this.shouldValidate(endpoint.outputValidation, ["test", "development"])) {
      // ADDME: add flag to disable for performance testing

      // Check if response is listed
      if (response.status.toString() in endpoint.responses || (response.status in HTTPErrorCode && this.defaultErrorSchema)) {
        let responseschema;
        if (response.status.toString() in endpoint.responses) {
          const responsedef = endpoint.responses[response.status] as OpenAPIV3.ResponseObject;
          const contentType = response.headers.get("content-type") || "application/json";
          responseschema = responsedef?.content?.[contentType]?.schema;
        }
        // Fallback to 'defaulterror' for errors, if specified in components.schemas
        if (!responseschema && response.status in HTTPErrorCode && this.defaultErrorSchema) {
          responseschema = this.defaultErrorSchema;
        }
        if (responseschema) {
          // skip validation when `"format": "binary"` is set in the schema
          if (!("format" in responseschema) || responseschema.format !== "binary") {
            const start = performance.now();
            const validator = this.getValidator(responseschema);
            const success = validator(await response.clone().json());
            logger.timings.responsevalidation = performance.now() - start;

            if (!success) {
              throw new Error(`Validation of the response (code ${response.status}) for ${JSON.stringify(`${req.method} ${relurl}`)} returned error: ${formatAjvError(validator.errors ?? [])}`);
            }
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

    if (endpoint.params) {
      const searchParams = new URL(req.url).searchParams;
      for (const param of endpoint.params) {
        let paramValues: string[] = [];
        if (param.in === "path") { //we already extracted path parameters during matching:
          paramValues = [decodeURIComponent(match.params[param.name])];
        } else if (param.in === "query") {
          paramValues = searchParams.getAll(param.name);
          if (!paramValues.length && param.required)
            return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Missing required query parameter ${param.name}}`);
        } else if (param.in === "header") {
          if (req.headers.has(param.name))
            paramValues = [req.headers.get(param.name)!];
          else if (param.required)
            return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Missing required header parameter ${param.name}`);
        } else {
          throw new Error(`Unsupported parameter location '${param.in}'`);
        }

        if (!paramValues.length)
          continue; //Unspecified parameter (TODO do we need to support default values?)

        let paramValue: unknown = paramValues[0];
        if (param.schema) {
          if ("type" in param.schema) {
            switch (param.schema.type) {
              case "number":
              case "integer": {
                if (!isNaN(Number(paramValues[0])))
                  paramValue = Number(paramValues[0]);
              } break;
              case "boolean": {
                paramValue = paramValues[0] === "1" || paramValues[0] === "true";
              } break;
              case "array": {
                if (!param.explode)
                  paramValues = paramValues[0].split(",");
                if (!param.schema.items || (param.schema.items as SchemaObject).type === "string") {
                  paramValue = paramValues;
                }
              }
            }
          }

          if (this.shouldValidate(endpoint.inputValidation, ["always"])) {
            const start = performance.now();
            const validator = this.getValidator(param.schema as SchemaObject);
            const success = validator(paramValue);
            logger.timings.validation += performance.now() - start;

            if (!success)
              return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Invalid parameter ${param.name}: ${formatAjvError(validator.errors ?? [])}`);
          }
        }

        params[param.name] = paramValue as typeof params[string];
      }
    }

    let body = null;
    const bodyschema = endpoint.requestBody?.content["application/json"]?.schema;
    if (bodyschema && this.shouldValidate(endpoint.inputValidation, ["always"])) {
      //We have something useful to proces
      const ctype = req.headers.get("content-type");
      if (ctype !== "application/json") //TODO what about endpoints supporting multiple types?
        return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Invalid content-type '${ctype}', expected application/json`);

      try {
        body = await req.json();
      } catch (e) { //parse error. There's no harm in 'leaking' a JSON parse error details
        return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Failed to parse the body: ${(e as Error)?.message}`);
      }

      // Validate the incoming request body (TODO cache validators, prevent parallel compilation when a lot of requests come in before we finished compilation)
      const start = performance.now();
      const validator = this.getValidator(bodyschema);
      const success = validator(body);
      logger.timings.validation += performance.now() - start;

      if (!success) {
        return await this.buildErrorResponse(HTTPErrorCode.BadRequest, `Invalid request body: ${formatAjvError(validator.errors ?? [])}`);
      }
    }

    const route = match.route.path.join("/");

    // Create the request object
    const restreq = new RestRequest(req, relurl, route, params, body);

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
        const authorizer = await importJSFunction<RestAuthorizationFunction>(authorizationfunction);

        authresult = await authcontext.run(async () => {
          // Run the authorizer first
          return authorizer(restreq);
        });
        if (!authresult.authorized)
          return authresult.response || await this.buildErrorResponse(HTTPErrorCode.Unauthorized, "Authorization is required for this endpoint");
        else if (authresult.loginfo)
          logger.authorized = authresult.loginfo;
      } finally {
        // FIXME: async delayed close of codecontext
        void authcontext.close();
        logger.timings.authorization = performance.now() - start;
      }
    }
    //FIXME merge autohrization info into loginfo
    restreq.authorization = authresult.authorization;
    if (!endpoint.handler)
      return await this.buildErrorResponse(HTTPErrorCode.NotImplemented, `Method ${req.method.toUpperCase()} for route '${relurl}' not yet implemented`);

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
        const resthandler = await importJSFunction<RestImplementationFunction>(handler);

        // Need to await here, otherwise handlercontext.close will run immediately
        return await handlercontext.run(async () => {
          // FIXME timeouts
          // Handle it!
          return resthandler(restreq);
        });
      } finally {
        // FIXME: async delayed close of codecontext
        void handlercontext.close();
        logger.timings.handling = performance.now() - start;
      }
    }
  }
}

export function getWorkerRestAPIHandler(serviceName: string, routes: Route[], defaultErrorSchema: SchemaObject | null, defaultErrorMapper: string, handlerInitHook: string | null) {
  return new WorkerRestAPIHandler(serviceName, routes, defaultErrorSchema, defaultErrorMapper, handlerInitHook);
}
