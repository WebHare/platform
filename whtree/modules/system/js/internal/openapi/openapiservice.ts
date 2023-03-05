import * as fs from "node:fs";
import YAML from "yaml";
import { toFSPath } from "@webhare/services";
import { RestAPI } from "./restapi";
import { createJSONResponse, WebRequest, WebResponse } from "@webhare/router";
import { WebRequestInfo, WebResponseInfo } from "../types";
import { HttpErrorCode } from "@webhare/router/src/response";

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
    const webreq = new WebRequest("GET", req.url);
    const response = await this.#runRestRouter(webreq, relurl);
    const headers = Object.entries(response.headers).map(([name, value]) => ({ name, value }));
    return { statusCode: 200, headers, body: response.body };
  }

  async #runRestRouter(req: WebRequest, relurl: string): Promise<WebResponse> {
    if (!this.restapi)
      throw new Error("RestService not initialized");

    relurl = relurl.split('?')[0]; //ignore query string

    // Shortcut to returning the OpenAPI definition
    if (relurl === "openapi.json") {
      return this.restapi.renderOpenAPIJSON({ filterxwebhare: true });
    }

    return createJSONResponse({ error: "Internal server error" }, { statusCode: HttpErrorCode.InternalServerError });
  }
}

export async function getServiceInstance(apispec: string) {
  //TODO cache restserver objects based on apispec
  const service = new RestService();
  await service.init(apispec);
  return service;
}
