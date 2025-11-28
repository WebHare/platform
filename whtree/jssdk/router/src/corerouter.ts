import * as whfs from "@webhare/whfs";
import { type WebHareWHFSRouter, type WebRequest, type WebResponse, createWebResponse } from "./router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { buildSiteRequest } from "./siterequest";
import * as undici from "undici";
import { importJSFunction } from "@webhare/services";
import { whconstant_webserver_hstrustedportoffset } from "@mod-system/js/internal/webhareconstants";
import { getBasePort } from "@webhare/services/src/config";

export async function lookupPublishedTarget(url: string, options?: whfs.LookupURLOptions) {
  const lookupresult = await whfs.lookupURL(new URL(url), options);
  if (!lookupresult.file)
    return null;

  const targetObject = await whfs.openFile(lookupresult.file);
  if (!targetObject || !targetObject.parentSite || !targetObject.parent)
    return null;

  //TODO also gather webdesign info
  const applytester = await getApplyTesterForObject(targetObject);
  const renderinfo = await applytester.getObjRenderInfo();

  return {
    lookupresult,
    targetObject,
    renderer: renderinfo.renderer
  };
}

export function getHSWebserverTarget(request: WebRequest) {
  const trustedlocalport = getBasePort() + whconstant_webserver_hstrustedportoffset;
  const trustedip = process.env["WEBHARE_SECUREPORT_BINDIP"] || "127.0.0.1"; //TODO we should probably name this WEBHARE_PROXYPORT_BINDIP ? not much secure about this port..
  //Convert Request headers to Undici compatible headers, filter out the dangeorus ones
  const headers = Object.fromEntries([...request.headers.entries()].filter(([header,]) => !["host", "x-forwarded-for", "x-forwarded-proto"].includes(header)));
  headers["x-forwarded-for"] = "1.2.3.4"; //FIXME use real remote IP, should be in 'request'
  const url = new URL(request.url);
  headers["x-forwarded-proto"] = url.protocol.split(':')[0]; //without ':'
  headers["host"] = url.host;
  const targeturl = `http://${trustedip}:${trustedlocalport}${url.pathname}${url.search}`;
  const fetchmethod = request.method;
  return { targeturl, fetchmethod, headers };
}

async function routeThroughHSWebserver(request: WebRequest): Promise<WebResponse> {
  //FIXME abortsignal / timeout
  const { targeturl, fetchmethod, headers } = getHSWebserverTarget(request);

  const fetchoptions: Parameters<typeof undici.request>[1] = {
    headers,
    method: fetchmethod as undici.Dispatcher.HttpMethod
  };

  if (!["GET", "HEAD"].includes(fetchmethod))
    fetchoptions.body = await request.text();

  //We can't fetch() as undici fetch will block Host: (and Cookie) headers
  const result = await undici.request(targeturl, fetchoptions);
  const body = await result.body.arrayBuffer(); //TODO even better if we can stream blobs

  //Rebuild headers to get rid of the dangerous ones
  //undici doesn't decompress itself so don't drop a returned content-encoding header!
  const newheaders = new Headers;
  for (const [header, value] of Object.entries(result.headers))
    if (value) {
      if (!['content-length', 'date'].includes(header) && !header.startsWith('transfer-'))
        for (const val of Array.isArray(value) ? value : [value])
          newheaders.append(header, val);
    }

  //A null body status is a status that is 101, 103, 204, 205, or 304.
  //We may not send a body with those
  const nullStatuses = [101, 103, 204, 205, 304];
  return createWebResponse(nullStatuses.includes(result.statusCode) ? undefined : body, { status: result.statusCode, headers: newheaders });
}

/* TODO Unsure if this should be a public API of @webhare/router or whether it should be part of the router at all. We risk
        dragging in a lot of dependencies here in the end, and may @webhare/router should only be for apps that implement routes, not execute them */

export async function coreWebHareRouter(request: WebRequest): Promise<WebResponse> {
  const target = await lookupPublishedTarget(request.url.toString(), { clientWebServer: request.clientWebServer }); //"Kijkt in database. Haalt file info en publisher info op"
  /* TODO we have to disable this to be able to resolve <backend> webrules.
          ideally we would only forward to the HS Websever if we hit a SHTML
  if (!target) //FIXME avoid new Error - it forces a stacktrace to be generated
    throw new Error("404 Unable to resolve the target. How do we route to a 404?"); //TODO perhaps there should be WebserverError exceptions similar to AbortWithHTTPError - and toplevel routers catch these ?
  */

  if (!target?.renderer) //Looks like we'll need to fallback to the WebHare webserver to handle this request
    return await routeThroughHSWebserver(request);

  //Invoke the render function. TODO seperate VM/ShadowRealm etc
  const renderer: WebHareWHFSRouter = await importJSFunction<WebHareWHFSRouter>(target.renderer);
  const whfsreq = await buildSiteRequest(request, target.targetObject);
  return await renderer(whfsreq);
}
