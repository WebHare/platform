import { createJSONResponse, HTTPSuccessCode, type OpenAPIServiceInitializationContext, type RestRequest, type WebResponse } from "@webhare/router";
import * as test from "@webhare/test";

export async function getExtensionCall(req: RestRequest): Promise<WebResponse> {
  test.eq('/extension', req.path);
  return createJSONResponse(HTTPSuccessCode.Ok, { message: "I have been extended" });
}

export function extendTheService(context: OpenAPIServiceInitializationContext) {
  test.eq("webhare_testsuite:extendedservice", context.name);
  context.spec.paths["/extension"] = {
    get: {
      description: "I have been extended",
      responses: {
        200: {
          description: "OK"
        }
      },
      "x-webhare-implementation": "@mod-webhare_testsuite/tests/wh/webserver/remoting/openapi/hooks.ts#getExtensionCall"
    }
  };
}
