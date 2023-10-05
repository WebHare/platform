import { WebRequestInfo, WebResponseInfo } from "../types";
import { loadJSFunction } from "../resourcetools";
import { newForwardedWebRequest, newWebRequestFromInfo } from "@webhare/router/src/request";
import { WebHareRouter, createWebResponse } from "@webhare/router/src/router";

class JSRouter {
  async routerCall(routerfunc: string, req: WebRequestInfo, localbaseurl: string): Promise<WebResponseInfo> {
    const router = await loadJSFunction(routerfunc) as WebHareRouter;
    let webreq;
    try {
      webreq = newForwardedWebRequest(await newWebRequestFromInfo(req), localbaseurl.substring(1));
    } catch (e) {
      return createWebResponse("Invalid URL", { status: 400 }).asWebResponseInfo();
    }

    const response = await router(webreq);
    return response.asWebResponseInfo();
  }
}

/** Initialize service
 * @param apispec - The openapi yaml spec resource
 * */
export async function getJSRouter() {
  return new JSRouter;
}
