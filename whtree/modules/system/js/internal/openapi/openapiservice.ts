import * as fs from "node:fs";
import YAML from "yaml";
import * as env from "@webhare/env";
import * as services from "@webhare/services";
import { loadWittyResource, toFSPath } from "@webhare/services";
import { RestAPI } from "./restapi";
import { createJSONResponse, WebRequest, WebResponse, HTTPErrorCode, createWebResponse } from "@webhare/router";
import { WebRequestInfo, WebResponseInfo } from "../types";
import { getOpenAPIService } from "@webhare/services/src/moduledefparser";
import { registerLoadedResource } from "../hmrinternal";

// A REST service supporting an OpenAPI definition
export class RestService {
  readonly restapi: RestAPI;

  constructor(restapi: RestAPI) {
    this.restapi = restapi;
  }

  async APICall(req: WebRequestInfo, relurl: string): Promise<WebResponseInfo> {
    //WebRequestInfo is an internal type used by openapiservice.shtml until we can be directly connected to the WebHareRouter
    const webreq = new WebRequest(req.url, { method: req.method, headers: req.headers, body: req.body });
    const response = await this.#runRestRouter(webreq, relurl);
    return { status: response.status, headers: Object.fromEntries(response.getHeaders()), body: await response.text() };
  }

  async #handleMetaPage(req: WebRequest, relurl: string): Promise<WebResponse> {
    //TODO it would be safer for the router to provide us with the absolutebaseurl of the current spec (and we can figure out relurl ourselves too then)
    let apibaseurl = req.url.toString();
    apibaseurl = apibaseurl.substring(0, apibaseurl.length - relurl.length);
    const relurl_spec = "openapi/openapi.json";
    const relurl_swaggerui = "openapi/swagger-ui";
    const apidata = {
      apibaseurl: apibaseurl,
      speclink: apibaseurl + relurl_spec,
      swaggeruilink: apibaseurl + relurl_swaggerui,
      //TODO once swagger UI 5 is final, we can remove this check and always use the new version
      is_31: this.restapi?.def?.openapi.startsWith("3.1") || false
    };

    //TODO get rid of unsafe-inline, but where to store our own JS/CSS to initalize openapi?
    const metapageheaders = { "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' https://cdnjs.cloudflare.com; img-src data: 'self' https://cdnjs.cloudflare.com;" };

    if (relurl == "" || relurl == relurl_swaggerui) { //webpage
      const witty = await loadWittyResource("mod::system/js/internal/openapi/openapi.witty");
      const comp = relurl == relurl_swaggerui ? "swaggerui" : "root";
      return createWebResponse(await witty.runComponent(comp, apidata), { headers: metapageheaders });
    }

    if (relurl == relurl_spec) {
      const indent = ["1", "true"].includes(new URL(req.url).searchParams.get("indent") || "");
      return this.restapi!.renderOpenAPIJSON(apibaseurl, { filterxwebhare: true, indent });
    }

    return createWebResponse("Not found", { status: HTTPErrorCode.NotFound }); //TODO or should we fallback to a global 404 handler... although that probably isn't useful inside a namespace intended for robots
  }

  async #runRestRouter(req: WebRequest, relurl: string): Promise<WebResponse> {
    if (!this.restapi)
      throw new Error("RestService not initialized");

    relurl = relurl.split('?')[0]; //ignore query string

    /* Builtin metapages. We use `openapi/` as we heope that is less likely to be used by an openapi server's routes
       than eg `meta/` */
    if (!relurl || relurl.startsWith("openapi/"))
      return this.#handleMetaPage(req, relurl);

    // Handle the request
    let result: WebResponse;
    try {
      result = await this.restapi.handleRequest(req, "/" + relurl);
    } catch (e) {
      services.logError(e as Error);

      if (env.flags.etr)
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: (e as Error).message, stack: (e as Error).stack });
      else if (services.config.dtapstage == "development")
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error - enable the 'etr' debug flag to enable full error tracing" });
      else
        result = createJSONResponse(HTTPErrorCode.InternalServerError, { error: "Internal error" });
    }

    if (env.flags.openapi) {
      services.log("system:debug", {
        request: req,
        response: { status: result.status, body: await result.text(), headers: Object.fromEntries(result.getHeaders()) },
        trace: result.trace
      });
    }

    return result;
  }
}

const cache: Record<string, RestService> = {};

/** Initialize service
 * @param apispec - The openapi yaml spec resource
 * */
export async function getServiceInstance(apispec: string) {
  if (cache[apispec])
    return cache[apispec];

  const serviceinfo = getOpenAPIService(apispec);
  if (!serviceinfo)
    throw new Error(`Invalid OpenAPI service name: ${apispec}`);

  const apispec_fs = toFSPath(serviceinfo.spec);
  registerLoadedResource(module, apispec_fs);

  // Read and parse the OpenAPI Yaml definition
  const def = YAML.parse(await fs.promises.readFile(apispec_fs, "utf8"));
  // Create and initialize the API handler
  const restapi = new RestAPI();
  await restapi.init(def, serviceinfo.spec);

  const service = new RestService(restapi);
  if (!cache[apispec])
    cache[apispec] = service;
  return service;
}
