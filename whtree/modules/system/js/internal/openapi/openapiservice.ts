import * as fs from "node:fs";
import YAML from "yaml";
import { toFSPath } from "@webhare/services";
import { RestAPI } from "./restapi";
import { createJSONResponse, WebRequest, WebResponse, HTTPErrorCode } from "@webhare/router";
import { WebRequestInfo, WebResponseInfo } from "../types";

// A REST service supporting an OpenAPI definition
export class RestService {
  restapi: RestAPI | null = null;

  /** Initialize
   * @param apispec - The openapi yaml spec resource
   * */
  async init(apispec: string) {
    // Read and parse the OpenAPI Yaml definition
    const def = YAML.parse(await fs.promises.readFile(toFSPath(apispec), "utf8"));
    // Create and initialize the API handler
    this.restapi = new RestAPI();
    try {
      await this.restapi.init(def, apispec);
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

  async #runRestRouter(req: WebRequest, relurl: string): Promise<WebResponse> {
    if (!this.restapi)
      throw new Error("RestService not initialized");

    relurl = relurl.split('?')[0]; //ignore query string

    // Shortcut to returning the OpenAPI definition (TODO optionally allow hiding or requiring auth)
    if (relurl === "openapi.json") {
      const apibaseurl = new URL(".", req.url).toString();
      return this.restapi.renderOpenAPIJSON(apibaseurl, { filterxwebhare: true });
    }

    return createJSONResponse({ error: "Internal server error" }, { status: HTTPErrorCode.InternalServerError });
  }
}

export async function getServiceInstance(apispec: string) {
  //TODO cache restserver objects based on apispec
  const service = new RestService();
  await service.init(apispec);
  return service;
}
