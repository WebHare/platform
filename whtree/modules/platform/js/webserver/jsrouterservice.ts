import type { WebRequestInfo, WebResponseInfo } from "../../../system/js/internal/types";
import { newForwardedWebRequest, newWebRequestFromInfo } from "@webhare/router/src/request";
import { type WebHareRouter, createWebResponse } from "@webhare/router/src/router";
import { importJSFunction } from "@webhare/services";
import { BackendServiceConnection } from "@webhare/services/src/backendservicerunner";

class JSRouter extends BackendServiceConnection {
  async routerCall(routerfunc: string, req: WebRequestInfo, localbaseurl: string): Promise<WebResponseInfo> {
    const router = await importJSFunction<WebHareRouter>(routerfunc);
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
