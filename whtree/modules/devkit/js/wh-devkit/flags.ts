/* Renders flags
   Eg: https://webhare.moe.sf.webhare.dev/.wh/devkit/flags/
   */

import { createWebResponse, type WebRequest, type WebResponse } from "@webhare/router";
import { backendConfig, loadWittyResource } from "@webhare/services";
import { swaggerUIHeaders } from "@mod-system/js/internal/openapi/openapiservice";
import { readFile } from "node:fs/promises";


export async function handleFlags(req: WebRequest): Promise<WebResponse> {
  const searchParams = new URL(req.url).searchParams;
  const flag = searchParams.get("flag");
  if (flag?.match(/^[a-zA-Z-]+$/)) {
    const filepath = `${backendConfig.installationRoot}/node_modules/flag-icons/flags/1x1/${flag}.svg`;
    const flagfile = await readFile(filepath, 'utf8');
    return createWebResponse(flagfile, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  const width = parseInt(searchParams.get("width") || '0');
  const height = parseInt(searchParams.get("height") || '0');
  const pixelratio = parseFloat(searchParams.get("pixelratio") || '1');
  const flagsParam = searchParams.get("flags") || '';
  const flags = flagsParam.split('.').map(f => f.trim()).filter(f => f.length > 0);

  if (!width || !height || !pixelratio || flags.length === 0) {
    return createWebResponse("Invalid parameters", { status: 400 });
  }

  const witty = await loadWittyResource("mod::devkit/lib/internal/flags/flags.html.witty");
  const data = {
    flagbase: new URL(req.url).pathname,
    flags: flags,
    loadwidth: width * pixelratio,
    loadheight: height * pixelratio
  };
  return createWebResponse(await witty.runComponent("flagoverview", data), { headers: swaggerUIHeaders });
}
