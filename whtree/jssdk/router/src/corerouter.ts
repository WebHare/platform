import * as whfs from "@webhare/whfs";
import { type WebHareWHFSRouter, type WebRequest, type WebResponse, createWebResponse } from "./router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { buildContentPageRequest } from "./siterequest";
import * as undici from "undici";
import { importJSFunction } from "@webhare/services";
import { whconstant_webserver_hstrustedportoffset } from "@mod-system/js/internal/webhareconstants";
import { getBasePort } from "@webhare/services/src/config";
import type { WebServerPort } from "@mod-platform/js/webserver/webserver";
import type { WebRequestInfo, WebResponseInfo } from "@mod-system/js/internal/types";
import { newWebRequestFromInfo } from "./request";
import { litty } from "@webhare/litty";
import { runHareScriptPage } from "./hswebdesigndriver";

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

export function getHSWebserverTarget(port: WebServerPort, request: WebRequest, localAddress: string) {
  const trustedlocalport = getBasePort() + whconstant_webserver_hstrustedportoffset;
  const trustedip = process.env["WEBHARE_SECUREPORT_BINDIP"] || "127.0.0.1"; //TODO we should probably name this WEBHARE_PROXYPORT_BINDIP ? not much secure about this port..

  //Convert Request headers to Undici compatible headers, filter out the dangeorus ones
  const headers = Object.fromEntries([...request.headers.entries()].filter(([header,]) => !["host", "x-forwarded-for", "x-forwarded-proto", "x-wh-proxy"].includes(header)));
  // headers["x-forwarded-for "] = request.clientIp;
  const url = new URL(request.url);
  //TODO local=...?
  headers["x-wh-proxy"] = `source=js;proto=${url.protocol.split(':')[0]};for=${request.clientIp};local=${localAddress}`;
  if (!port.port.istrustedport)
    headers["x-wh-proxy"] += `;binding=${port.port.id}`;
  //For non-virtual hosted ports transmit the original request host. This allows the HS webserver to build clientrequesturl
  headers["host"] = (!port.port.virtualhost ? request.headers.get("host") : null) ?? url.host;
  const targeturl = `http://${trustedip}:${trustedlocalport}${url.pathname}${url.search}`;
  const fetchmethod = request.method;
  return { targeturl, fetchmethod, headers };
}

async function routeThroughHSWebserver(port: WebServerPort, request: WebRequest, localAddress: string): Promise<WebResponse> {
  //FIXME abortsignal / timeout
  const { targeturl, fetchmethod, headers } = getHSWebserverTarget(port, request, localAddress);

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
      if (!['date'].includes(header) && !header.startsWith('transfer-'))
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

export async function coreWebHareRouter(port: WebServerPort, request: WebRequest, localAddress: string): Promise<WebResponse> {
  const target = await lookupPublishedTarget(request.url.toString(), { clientWebServer: request.clientWebServer }); //"Kijkt in database. Haalt file info en publisher info op"
  /* TODO we have to disable this to be able to resolve <backend> webrules.
          ideally we would only forward to the HS Websever if we hit a SHTML
  if (!target) //FIXME avoid new Error - it forces a stacktrace to be generated
    throw new Error("404 Unable to resolve the target. How do we route to a 404?"); //TODO perhaps there should be WebserverError exceptions similar to AbortWithHTTPError - and toplevel routers catch these ?
  */

  if (!target?.renderer) //Looks like we'll need to fallback to the WebHare webserver to handle this request
    return await routeThroughHSWebserver(port, request, localAddress);

  //Invoke the render function. TODO seperate VM/ShadowRealm etc
  const renderer: WebHareWHFSRouter = await importJSFunction<WebHareWHFSRouter>(target.renderer);
  const whfsreq = await buildContentPageRequest(request, target.targetObject);
  return await renderer(whfsreq);
}

export async function executeSHTMLRequestHS(webreq: WebRequestInfo, webdesignurl: string, funcname: string, funcarg: unknown) {
  const req = await newWebRequestFromInfo(webreq);
  const lookupresult = await whfs.lookupURL(new URL(webdesignurl), { clientWebServer: req.clientWebServer });
  if (!lookupresult?.folder)
    throw new Error(`Unable to lookup webdesign for url '${webdesignurl}'`);

  const targetObject = await whfs.openFileOrFolder(lookupresult.file ?? lookupresult.folder);
  const whfsreq = await buildContentPageRequest(req, targetObject);
  return (await runHareScriptPage(whfsreq, { pageRouter: { funcname, funcarg } })).asWebResponseInfo();
}

export async function executeContentPageRequestHS(targetId: number, options?: {
  contentfile?: number;
  errorcode?: number;
  webreq?: WebRequestInfo;
}): Promise<WebResponseInfo> {
  const req = options?.webreq ? await newWebRequestFromInfo(options.webreq) : null;

  const targetObject = await whfs.openFileOrFolder(targetId);
  if (!targetObject || !targetObject.parentSite || !targetObject.parent)
    throw new Error(`Invalid fileid '${targetId}' for content page request`);

  const contentObject = options?.contentfile ? await whfs.openFile(options.contentfile) : undefined;
  const whfsreq = await buildContentPageRequest(req, targetObject, { statusCode: options?.errorcode, contentObject });
  if (options?.errorcode) {
    //FIXMES We need to create proper error page body. Pass sufficient info to the webdesign?
    const resp = await whfsreq.buildWebPage(litty`Errorcode ${options.errorcode}`);
    return resp.asWebResponseInfo();
  }

  const renderer = await whfsreq.getPageRenderer();
  if (!renderer)
    throw new Error(`No renderer found for fileid '${targetId}' ${contentObject ? ` (content link to ${contentObject.id})` : ""} - should not have been routed through us ? `);

  return (await renderer(whfsreq)).asWebResponseInfo();
}
