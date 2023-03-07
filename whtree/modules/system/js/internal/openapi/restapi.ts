import SwaggerParser from "@apidevtools/swagger-parser";
import { createJSONResponse, HTTPErrorCode, WebRequest, RestParams, RestRequest, WebResponse, HTTPMethod, RestAuthorizationFunction, RestImplementationFunction } from "@webhare/router";
import Ajv from "ajv";
import { OpenAPIV3 } from "openapi-types";
import { resolveResource } from "@webhare/services";
import { loadJSFunction } from "../resourcetools";

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
}

interface Route {
  // The path parts, e.g. ["users", "{userid}", "tokens"]
  path: string[];
  // The path-parameters to gather on this route
  params: OpenAPIV3.ParameterObject[];
  // Supported methods
  methods: Partial<Record<HTTPMethod, Operation>>;
}

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

// An OpenAPI handler
export class RestAPI {
  _ajv: Ajv | null = null;
  def: WHOpenAPIDocument | null = null;

  // Get the JSON schema validator singleton
  protected get ajv() {
    if (!this._ajv) {
      this._ajv = new Ajv();
    }
    return this._ajv;
  }

  private routes: Route[] = [];

  async init(def: string, specresourcepath: string) {
    // Parse the OpenAPI definition
    const parsed = await SwaggerParser.validate(def);
    if (!(parsed as OpenAPIV3.Document).openapi?.startsWith("3.0"))
      throw new Error(`Unsupported OpenAPI version ${parsed.info.version}`);

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
              authorization: operation_authorization
            };
          }
        }
        this.routes.push(route);
      }
    }
  }

  findRoute(relurl: string, req: WebRequest) {
    const path = relurl.split("/");
    for (const route of this.routes) {
      const params = matchesPath(path, route.path, req);
      if (params) //it's a match, and we parsed the params while we're at it..
        return { route: route, params };
    }
    return null;
  }

  async handleRequest(req: WebRequest, relurl: string): Promise<WebResponse> {
    if (!this.def) //TODO with 'etr' return validation issues
      return createJSONResponse({ error: `Service not configured` }, { status: HTTPErrorCode.InternalServerError });

    // Find the route matching the request path
    const match = this.findRoute(relurl, req);
    if (!match)
      return createJSONResponse({ error: `No route for '${relurl}'` }, { status: HTTPErrorCode.NotFound });

    const endpoint = match.route.methods[req.method];
    if (!endpoint)
      return createJSONResponse({ error: `Method ${req.method.toUpperCase()} not allowed for route '${relurl}'` }, { status: HTTPErrorCode.MethodNotAllowed });
    if (!endpoint.authorization) //TODO with 'etr' return more about 'why'
      return createJSONResponse({ error: `Not authorized` }, { status: HTTPErrorCode.Forbidden });

    // Build parameters (eg. from the path or from the query)
    const params: RestParams = {};
    if (endpoint.params)
      for (const param of endpoint.params) {
        let paramvalue: null | string = null;
        if (param.in === "path") { //we already extracted path parameters during matching:
          paramvalue = match.params[param.name];
        } else if (param.in === "query") {
          paramvalue = req.url.searchParams.get(param.name);
        } else {
          throw new Error(`Unsupported parameter location '${param.in}'`);
        }

        if (paramvalue === null)
          continue; //Unspecified parameter (TODO do we need to support default values?)

        // We'll only convert 'number' parameters, other parameters will be supplied as strings
        if ((param.schema as OpenAPIV3.SchemaObject)?.type === "number")
          params[param.name] = parseInt(paramvalue) ?? 0;
        else
          params[param.name] = paramvalue;
      }

    let body = null;
    const bodyschema = endpoint.requestBody?.content["application/json"]?.schema;
    if (bodyschema) {
      //We have something useful to proces
      const ctype = req.headers.get("content-type");
      if (ctype != "application/json") //TODO what about endpoints supporting multiple types?
        return createJSONResponse({ error: `Invalid content-type '${ctype}', expected application/json` }, { status: HTTPErrorCode.BadRequest });

      try {
        body = JSON.parse(req.body);
      } catch (e) { //parse error. There's no harm in 'leaking' a JSON parse error details
        return createJSONResponse({ error: `Failed to parse the body: ${(e as Error)?.message}` }, { status: HTTPErrorCode.BadRequest });
      }

      // Validate the incoming request body (TODO cache validators, prevent parallel compilation when a lot of requests come in before we finished compilation)
      const validator = this.ajv.compile(bodyschema);
      if (!validator(body)) {
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
        return createJSONResponse({ error: validator.errors?.[0]?.message || `Invalid request body` }, { status: HTTPErrorCode.BadRequest });
      }
    }

    // Create the request object
    const restreq = new RestRequest(req, relurl, params, body);

    // Run the authorizer first
    const authorizer = (await loadJSFunction(endpoint.authorization)) as RestAuthorizationFunction;
    const authresult = await authorizer(restreq);
    if (!authresult.authorized)
      return authresult.response || createJSONResponse(null, { status: HTTPErrorCode.Unauthorized });

    restreq.authorization = authresult.authorization;
    if (!endpoint.handler)
      return createJSONResponse({ error: `Method ${req.method.toUpperCase()} for route '${relurl}' not yet implemented` }, { status: HTTPErrorCode.NotImplemented });

    // FIXME should we cache the resolved handler or will that break auto reloading?
    const resthandler = (await loadJSFunction(endpoint.handler)) as RestImplementationFunction;

    // FIXME vm/shadowrealms? and timeouts
    // Handle it!
    return await resthandler(restreq);
  }

  renderOpenAPIJSON(baseurl: string, options: { filterxwebhare: boolean }): WebResponse {
    let def = { ...this.def };
    if (options.filterxwebhare)
      def = filterXWebHare(def) as typeof def;

    if (!this.def)
      return createJSONResponse({ error: `Service not configured` }, { status: HTTPErrorCode.InternalServerError });

    if (def.servers)
      for (const server of def.servers)
        if (server.url)
          server.url = new URL(server.url, baseurl).toString();

    return createJSONResponse(def);
  }
}
