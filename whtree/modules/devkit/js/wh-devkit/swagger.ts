/* Renders swagger pages using our existing assets
   Eg: https://webhare.moe.sf.webhare.dev/.wh/devkit/instant-swagger?service=platform:api
   */

import { createWebResponse, type WebRequest, type WebResponse } from "@webhare/router";
import { loadWittyResource } from "@webhare/services";
import { swaggerUIHeaders, describeService } from "@mod-system/js/internal/openapi/openapiservice";
import { renderOpenAPIJSON } from "@mod-system/js/internal/openapi/restapi";


export async function instantSwagger(req: WebRequest): Promise<WebResponse> {
  const params = new URL(req.url).searchParams;
  const serviceName = params.get("service")!;
  const service = await describeService(serviceName!);

  if (req.localPath === "instant-swagger/spec")
    return renderOpenAPIJSON(service.bundled, req.url, { filterxwebhare: true, indent: false });

  const apidata = {
    speclink: new URL("instant-swagger/spec?service=" + encodeURIComponent(serviceName), req.url).toString(),
    options: {}
  };

  const witty = await loadWittyResource("mod::system/js/internal/openapi/openapi.witty");
  return createWebResponse(await witty.runComponent("swaggerui", apidata), { headers: swaggerUIHeaders });
}
