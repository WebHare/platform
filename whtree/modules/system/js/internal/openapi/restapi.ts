import SwaggerParser from "@apidevtools/swagger-parser";
import { createJSONResponse, HTTPErrorCode, WebResponse } from "@webhare/router";
import Ajv from "ajv";
import { OpenAPIV3 } from "openapi-types";

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

// An OpenAPI handler
export class RestAPI {
  _ajv: Ajv | null = null;
  def: OpenAPIV3.Document | null = null;

  // Get the JSON schema validator singleton
  protected get ajv() {
    if (!this._ajv) {
      this._ajv = new Ajv();
    }
    return this._ajv;
  }

  async init(def: string, basepath: string) {
    // Parse the OpenAPI definition
    const parsed = await SwaggerParser.validate(def);
    if (!(parsed as OpenAPIV3.Document).openapi?.startsWith("3.0"))
      throw new Error(`Unsupported OpenAPI version ${parsed.info.version}`);
    this.def = parsed as OpenAPIV3.Document;
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
