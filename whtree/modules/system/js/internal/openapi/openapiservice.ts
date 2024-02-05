import * as fs from "node:fs";
import YAML from "yaml";
import * as env from "@webhare/env";
import * as services from "@webhare/services";
import { loadWittyResource, log, toFSPath } from "@webhare/services";
import { LogInfo, RestAPI } from "./restapi";
import { createJSONResponse, WebRequest, WebResponse, HTTPErrorCode, createWebResponse, HTTPSuccessCode } from "@webhare/router";
import { WebRequestInfo, WebResponseInfo } from "../types";
import { registerLoadedResource } from "../hmrinternal";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { LoggableRecord } from "@webhare/services/src/logmessages";
import { getExtractedConfig } from "../configuration";

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
      const response = await (await this.#runRestRouter(webreq, relurl, logger)).asWebResponseInfo();
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

    //TODO get rid of unsafe-inline, but where to store our own JS/CSS to initalize openapi?
    //     looks like swagger itself also needs a bit of inline styling, so adding that
    const metapageheaders = { "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data: 'self' https://cdnjs.cloudflare.com;" };

    if (relurl == "" || relurl == relurl_swaggerui) { //webpage
      const witty = await loadWittyResource("mod::system/js/internal/openapi/openapi.witty");
      const comp = relurl == relurl_swaggerui ? "swaggerui" : "root";
      return createWebResponse(await witty.runComponent(comp, apidata), { headers: metapageheaders });
    }

    /* https://publicatie.centrumvoorstandaarden.nl/api/adr/#documentation API-51: Publish OAS document at a standard location in JSON-format
        Publish it at /openapi.json (we used /openapi/openapi.json before) */
    if (relurl == relurl_spec) {
      const indent = ["1", "true"].includes(new URL(req.url).searchParams.get("indent") || "");
      return this.restapi!.renderOpenAPIJSON(apibaseurl, { filterxwebhare: true, indent });
    }

    // Temporary redirect for old url. Remove eg. after 2023-06-13
    if (relurl == "openapi/openapi.json")
      return createWebResponse("Moved permanently", { status: HTTPSuccessCode.MovedPermanently, headers: { location: apibaseurl + relurl_spec } });

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
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: (e as Error).message, stack: (e as Error).stack });
      else if (services.backendConfig.dtapstage == "development")
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error - enable the 'etr' debug flag to enable full error tracing" });
      else
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error" });
    }

    if (env.debugFlags.openapi) {
      services.log("system:debug", {
        request: { method: req.method, headers: Object.fromEntries(req.headers.entries()), url: req.url.toString() },
        response: { status: result.status, body: await result.text(), headers: Object.fromEntries(result.getHeaders()) },
        trace: result.trace || null
      });
    }

    return result;
  }

  close() {
    this.restapi.close();
  }
}

const cache: Record<string, RestService> = {};

/** Initialize service
 * @param apispec - The openapi yaml spec resource
 * */
export async function getServiceInstance(servicename: string) {
  if (cache[servicename])
    return cache[servicename];

  const serviceconfig = getExtractedConfig("services");
  const serviceinfo = serviceconfig.openAPIServices.find(_ => _.name === servicename);
  if (!serviceinfo)
    throw new Error(`Invalid OpenAPI service name: ${servicename}`);

  const apispec_fs = toFSPath(serviceinfo.spec);
  registerLoadedResource(module, apispec_fs);
  const apimerge_fs = serviceinfo.merge && toFSPath(serviceinfo.merge);
  if (apimerge_fs)
    registerLoadedResource(module, apimerge_fs);

  // Read and parse the OpenAPI Yaml definition
  const def = YAML.parse(await fs.promises.readFile(apispec_fs, "utf8"));
  const merge = apimerge_fs ? YAML.parse(await fs.promises.readFile(apimerge_fs, "utf8")) : {};
  // Create and initialize the API handler
  const restapi = new RestAPI();
  await restapi.init(def, serviceinfo.spec, { merge });

  const service = new RestService(servicename, restapi);
  if (!cache[servicename])
    cache[servicename] = service;
  return service;
}
