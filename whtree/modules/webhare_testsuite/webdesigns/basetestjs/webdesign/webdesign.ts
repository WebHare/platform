import { SiteResponseSettings } from "@webhare/router";
import { WebDesignFunction, SiteRequest, SiteResponse, WebResponse } from "@webhare/router";

export interface BaseTestPageConfig {
  whfspath: string;
}

export async function BaseTestJSDesign(request: SiteRequest, webresponse: WebResponse, settings: SiteResponseSettings) {
  const pageconfig = { whfspath: request.targetobject.whfspath };
  return new SiteResponse(pageconfig, request, webresponse, settings);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const BaseTestJSDesignValidator: WebDesignFunction<BaseTestPageConfig> = BaseTestJSDesign;
