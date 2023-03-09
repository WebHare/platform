import * as fs from "node:fs";
import YAML from "yaml";
import { loadWittyResource, toFSPath } from "@webhare/services";
import { RestAPI } from "./restapi";
import { createJSONResponse, WebRequest, WebResponse, HTTPErrorCode, createWebResponse } from "@webhare/router";
import { WebRequestInfo, WebResponseInfo } from "../types";
import { getOpenAPIService } from "@webhare/services/src/moduledefparser";

// A REST service supporting an OpenAPI definition
export class RestService {
  restapi: RestAPI | null = null;

  /** Initialize
   * @param apispec - The openapi yaml spec resource
   * */
  async init(apispec: string) {
    const serviceinfo = getOpenAPIService(apispec);
    if (!serviceinfo)
      throw new Error(`Invalid OpenAPI service name: ${apispec}`);

    // Read and parse the OpenAPI Yaml definition
    const def = YAML.parse(await fs.promises.readFile(toFSPath(serviceinfo.spec), "utf8"));
    // Create and initialize the API handler
    this.restapi = new RestAPI();
    try {
      await this.restapi.init(def, serviceinfo.spec);
    } catch (e) {
      //FIXME deal with the error, don't swallow!
      console.error(e);
    }
  }

  async APICall(req: WebRequestInfo, relurl: string): Promise<WebResponseInfo> {
    //WebRequestInfo is an internal type used by openapiservice.shtml until we can be directly connected to the WebHareRouter
    const webreq = new WebRequest(req.url, { method: req.method, headers: req.headers, body: req.body });
    const response = await this.#runRestRouter(webreq, relurl);
    return { status: response.status, headers: response.headers, body: response.body };
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
      swaggeruilink: apibaseurl + relurl_swaggerui
    };

    //TODO get rid of unsafe-inline, but where to store our own JS/CSS to initalize openapi?
    const metapageheaders = { "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' https://cdnjs.cloudflare.com; img-src data: 'self' https://cdnjs.cloudflare.com;" };

    if (relurl == "" || relurl == relurl_swaggerui) { //webpage
      const witty = await loadWittyResource("mod::system/js/internal/openapi/openapi.witty");
      const comp = relurl == relurl_swaggerui ? "swaggerui" : "root";
      return createWebResponse(await witty.runComponent(comp, apidata), { headers: metapageheaders });
    }

    if (relurl == relurl_spec)
      return this.restapi!.renderOpenAPIJSON(apibaseurl, { filterxwebhare: true });

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
    try {
      return await this.restapi.handleRequest(req, "/" + relurl);
    } catch (e) {
      //TODO reveal more info when debugflag etr is set and verified. Also ensure notice logging!
      console.error(e);
      return createJSONResponse({ error: "Internal error" }, { status: HTTPErrorCode.InternalServerError });
    }
  }
}

export async function getServiceInstance(apispec: string) {
  //TODO cache restserver objects based on apispec
  const service = new RestService();
  await service.init(apispec);
  return service;
}
