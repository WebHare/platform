import type { HTTPErrorCode, HTTPStatusCode } from "@webhare/router";

export type OpenAPIResponse<BodyType> = {
  status: HTTPErrorCode | HTTPStatusCode;
  headers: Headers;
  contenttype: string;
  ///Body. JSON decoded if the response indicated JSON output, raw otherwise
  body: BodyType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResponse = any;

export class RawOpenAPIClient {
  readonly baseurl: string;
  defaultheaders: Record<string, string> = {};

  constructor(baseurl: string, options: {
    bearerToken?: string;
    /** @deprecated use bearerToken in WH5.7+  */
    bearertoken?: string;
  }) {
    this.baseurl = baseurl;
    if (options?.bearerToken || options?.bearertoken)
      this.defaultheaders["Authorization"] = "Bearer " + (options.bearerToken || options?.bearertoken);
  }

  async invoke<BodyType = AnyResponse>(method: string, route: string, requestbody: string): Promise<OpenAPIResponse<BodyType>> {
    const fetchoptions: RequestInit = { method, headers: this.defaultheaders };
    if (requestbody) {
      fetchoptions.body = requestbody;
      (fetchoptions.headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    const call = await fetch(this.baseurl + route, fetchoptions);
    const contenttype = call.headers.get("Content-Type") || "";
    const responsebody = contenttype === "application/json" ? await call.json() : await call.text();
    const retval = { status: call.status, headers: call.headers, contenttype, body: responsebody };

    return retval;
  }

  async get<BodyType = AnyResponse>(route: string): Promise<OpenAPIResponse<BodyType>> {
    return this.invoke("GET", route, "");
  }
  async post<BodyType = AnyResponse>(route: string, body: unknown): Promise<OpenAPIResponse<BodyType>> {
    return this.invoke("POST", route, JSON.stringify(body));
  }
  async patch<BodyType = AnyResponse>(route: string, body: unknown): Promise<OpenAPIResponse<BodyType>> {
    return this.invoke("PATCH", route, JSON.stringify(body));
  }
  async put<BodyType = AnyResponse>(route: string, body: unknown): Promise<OpenAPIResponse<BodyType>> {
    return this.invoke("PUT", route, JSON.stringify(body));
  }
  async delete<BodyType = AnyResponse>(route: string): Promise<OpenAPIResponse<BodyType>> {
    return this.invoke("DELETE", route, "");
  }
}
