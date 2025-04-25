import * as fs from "node:fs";
import * as env from "@webhare/env";
import * as services from "@webhare/services";
import SwaggerParser from "@apidevtools/swagger-parser";
import { WebHareBlob, loadWittyResource, log, toFSPath } from "@webhare/services";
import { LogInfo, RestAPI, type OpenAPIInitHookFunction } from "./restapi";
import { createJSONResponse, type WebRequest, type WebResponse, HTTPErrorCode, createWebResponse, type WebHareOpenAPIDocument } from "@webhare/router";
import type { WebRequestInfo, WebResponseInfo } from "../types";
import { registerResourceDependency } from "../../../../../jssdk/services/src/hmrinternal";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import type { LoggableRecord } from "@webhare/services/src/logmessages";
import { getExtractedConfig } from "../configuration";
import { pick } from "@webhare/std";
import { handleCrossOriginResourceSharing } from "../webserver/cors";
import { decodeYAML } from "@mod-platform/js/devsupport/validation";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { mergeIntoBundled } from "../generation/gen_openapi";

const cache: Record<string, RestService> = {};

//TODO get rid of unsafe-inline, but where to store our own JS/CSS to initalize openapi?
//     looks like swagger itself also needs a bit of inline styling, so adding that
export const swaggerUIHeaders = {
  "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data: 'self' https://cdnjs.cloudflare.com;"
};

// A REST service supporting an OpenAPI definition
export class RestService extends services.BackendServiceConnection {
  readonly servicename: string;
  readonly restapi: RestAPI;

  constructor(servicename: string, restapi: RestAPI) {
    super();
    this.servicename = servicename;
    this.restapi = restapi;
  }

  async APICall(req: WebRequestInfo, relurl: string): Promise<WebResponseInfo> {
    //WebRequestInfo is an internal type used by openapiservice.shtml until we can be directly connected to the WebHareRouter
    const start = performance.now();
    const logger = new LogInfo(req.sourceip, req.method.toLowerCase());
    try {
      const webreq = await newWebRequestFromInfo(req);
      const accessControl = handleCrossOriginResourceSharing(webreq, { crossdomainOrigins: this.restapi.crossdomainOrigins });
      let response: WebResponseInfo;
      // If this is a preflight request, just return the result
      if (accessControl?.preflight) {
        response = {
          status: accessControl.success ? 200 : 405,
          headers: accessControl.headers,
          body: WebHareBlob.from(""),
          setCookie: []
        };
      } else {
        response = await (await this.#runRestRouter(webreq, relurl, logger)).asWebResponseInfo();
        // Add access control headers, if any
        if (accessControl) {
          for (const [header, value] of Object.entries(accessControl.headers))
            response.headers[header] = value;
        }
      }
      //TODO It's a bit ugly to be working with a HareScriptBlob here (`body.size`) as this is still JS code, but it's a quick workaround for not having to JSON.stringify twice
      this.logRequest(logger, response.status, response.body.size, start);
      return response;
    } catch (e) {
      this.logRequest(logger, 500, 0, start);
      throw e;
    }
  }

  logRequest(logger: LogInfo, status: number, response: number, start: number) {
    const totaltime = performance.now() - start;
    const timings = { ...logger.timings, total: totaltime };
    const logrec: LoggableRecord = { service: this.servicename, method: logger.method, route: logger.route, status, sourceip: logger.sourceip, response, timings };
    if (logger.authorized)
      logrec.authorized = logger.authorized;

    log("system:apicalls", logrec);
  }

  async #handleMetaPage(req: WebRequest, relurl: string): Promise<WebResponse> {
    //TODO it would be safer for the router to provide us with the absolutebaseurl of the current spec (and we can figure out relurl ourselves too then)
    let apibaseurl = req.url.toString();
    apibaseurl = apibaseurl.substring(0, apibaseurl.length - relurl.length);
    const relurl_spec = "openapi.json";
    const relurl_swaggerui = "openapi/swagger-ui";
    const apidata = {
      apibaseurl: apibaseurl,
      speclink: apibaseurl + relurl_spec,
      swaggeruilink: apibaseurl + relurl_swaggerui
    };

    if (relurl === "" || relurl === relurl_swaggerui) { //webpage
      const witty = await loadWittyResource("mod::system/js/internal/openapi/openapi.witty");
      const comp = relurl === relurl_swaggerui ? "swaggerui" : "root";
      return createWebResponse(await witty.runComponent(comp, apidata), { headers: swaggerUIHeaders });
    }

    /* https://publicatie.centrumvoorstandaarden.nl/api/adr/#documentation API-51: Publish OAS document at a standard location in JSON-format
        Publish it at /openapi.json (we used /openapi/openapi.json before) */
    if (relurl === relurl_spec) {
      const indent = ["1", "true"].includes(new URL(req.url).searchParams.get("indent") || "");
      return this.restapi!.renderOpenAPIJSON(apibaseurl, { filterxwebhare: true, indent });
    }

    return createWebResponse("Not found", { status: HTTPErrorCode.NotFound }); //TODO or should we fallback to a global 404 handler... although that probably isn't useful inside a namespace intended for robots
  }

  async #runRestRouter(req: WebRequest, relurl: string, logger: LogInfo): Promise<WebResponse> {
    if (!this.restapi)
      throw new Error("RestService not initialized");

    relurl = relurl.split('?')[0]; //ignore query string

    /* Builtin metapages. We use `openapi/` as we heope that is less likely to be used by an openapi server's routes
       than eg `meta/` */
    if (!relurl || relurl === "openapi.json" || relurl.startsWith("openapi/")) {
      return this.#handleMetaPage(req, relurl);
    }

    // Handle the request
    let result: WebResponse;
    try {
      result = await this.restapi.handleRequest(req, "/" + relurl, logger);
    } catch (e) {
      services.logError(e as Error);

      if (env.debugFlags.etr)
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: (e as Error).message, stack: (e as Error).stack, status: 500 });
      else if (services.backendConfig.dtapstage === "development")
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error - enable the 'etr' debug flag to enable full error tracing", status: 500 });
      else
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error", status: 500 });
    }

    if (env.debugFlags.openapi) {
      services.log("system:debug", {
        request: { method: req.method, headers: Object.fromEntries(req.headers.entries()), url: req.url.toString() },
        response: { status: result.status, body: await result.text(), headers: Object.fromEntries(result.headers.entries()) },
        trace: result.trace || null
      });
    }

    return result;
  }

  [Symbol.dispose]() {
    this.restapi[Symbol.dispose]();
    super[Symbol.dispose]();
  }
}

/** Describe an OpenAPI rest service */
export async function describeService(servicename: string) {
  const serviceconfig = getExtractedConfig("services");
  const serviceinfo = serviceconfig.openAPIServices.find(_ => _.name === servicename);
  if (!serviceinfo)
    throw new Error(`Invalid OpenAPI service name: ${servicename}`);

  const dependencies: string[] = [];

  const apispec_fs = toFSPath(serviceinfo.spec);
  dependencies.push(apispec_fs);

  const apimerge_fs = serviceinfo.merge && toFSPath(serviceinfo.merge);
  if (apimerge_fs)
    dependencies.push(apimerge_fs);

  // Read and parse the OpenAPI Yaml definition
  const def = decodeYAML<object>(await fs.promises.readFile(apispec_fs, "utf8"));
  const merge = apimerge_fs ? decodeYAML<object>(await fs.promises.readFile(apimerge_fs, "utf8")) : {};
  const options = { merge, ...pick(serviceinfo, ["name", "inputValidation", "outputValidation", "crossdomainOrigins", "initHook", "handlerInitHook"]) };

  // Bundle all external files into one document
  const bundled = await SwaggerParser.bundle(apispec_fs, def as WebHareOpenAPIDocument, {}) as WebHareOpenAPIDocument;

  if (merge)
    mergeIntoBundled(bundled, merge || {}, "");

  // Activate hooks (FIXME how to flush them?)
  if (options.initHook) {
    await using context = new CodeContext("initHook", { initHook: options.initHook });
    const tocall = await services.importJSFunction<OpenAPIInitHookFunction>(options.initHook);
    await context.run(() => tocall({ name: servicename, spec: bundled }));
  }

  return { bundled, spec: serviceinfo.spec, dependencies, options };
}

/** Initialize service
 * @param apispec - The openapi yaml spec resource
 * */
export async function getServiceInstance(servicename: string): Promise<RestService> {
  if (cache[servicename])
    return cache[servicename];

  const serviceinfo = await describeService(servicename);
  for (const dep of serviceinfo.dependencies)
    registerResourceDependency(module, dep);

  const restapi = new RestAPI(serviceinfo.bundled);
  await restapi.init(serviceinfo.spec, serviceinfo.options);

  const service = new RestService(servicename, restapi);
  if (!cache[servicename])
    cache[servicename] = service;
  return service;
}
