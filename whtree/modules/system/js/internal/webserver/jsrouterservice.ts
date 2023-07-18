import { WebRequestInfo, WebResponseInfo } from "../types";
import { loadJSFunction } from "../resourcetools";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { WebHareRouter } from "@webhare/router/src/router";

class JSRouter {
  async routerCall(routerfunc: string, req: WebRequestInfo, relurl: string): Promise<WebResponseInfo> {
    const router = await loadJSFunction(routerfunc) as WebHareRouter;
    const webreq = newWebRequestFromInfo(req);
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
