import { callHareScript } from "@webhare/services";
import * as whfs from "@webhare/whfs";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { WebHareWHFSRouter, WebRequest, WebResponse } from "./router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { buildSiteRequest } from "./siterequest";

export async function lookupPublishedTarget(url: string) {
  //we'll use the HS version for now. rebuilding lookup is complex and we should really port the tests too before we attempt it...
  const lookupresult = await callHareScript("mod::publisher/lib/publisher.whlib#LookupPublisherURL", [url], { openPrimary: true }) as { file: number }; //TODO also send the clientwebserver id
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
  const trustedlocalport = getFullConfigFile().baseport + 3; //3 = whconstant_webserver_hstrustedportoffset
  const trustedip = process.env["WEBHARE_SECUREPORT_BINDIP"] || "127.0.0.1"; //TODO we should probably name this WEBHARE_PROXYPORT_BINDIP ? not much secure about this port..
  const headers = request.headers;
  headers.set("X-Forwarded-For", "1.2.3.4"); //FIXME use real remote IP, should be in 'request'
  headers.set("X-Forwarded-Proto", request.url.protocol.split(':')[0]); //without ':'
  headers.set("Host", request.url.host);
  const targeturl = `http://${trustedip}:${trustedlocalport}${request.url.pathname}${request.url.search}`;
  const fetchmethod = request.method.toUpperCase();
  return { targeturl, fetchmethod, headers };
}

async function routeThroughHSWebserver(request: WebRequest): Promise<WebResponse> {
  //FIXME abortsignal / timeout
  const { targeturl, fetchmethod, headers } = getHSWebserverTarget(request);

  const fetchoptions: RequestInit = {
    redirect: "manual",
    headers,
    method: fetchmethod
  };
  if (!["GET", "HEAD"].includes(fetchmethod))
    fetchoptions.body = await request.text();

  const result = await fetch(targeturl, fetchoptions);
  const body = await result.arrayBuffer(); //TODO even better if we can stream blobs

  //Rebuild headers to get rid of the dangerous ones
  const newheaders = new Headers(result.headers);
  for (const header of result.headers.keys())
    if (['content-length', 'date', 'content-encoding'].includes(header) || header.startsWith('transfer-'))
      newheaders.delete(header);

  const resp = new WebResponse(result.status, newheaders);
  resp.setBody(body);
  return resp;
}

/* TODO Unsure if this should be a public API of @webhare/router or whether it should be part of the router at all. We risk
        dragging in a lot of dependencies here in the end, and may @webhare/router should only be for apps that implement routes, not execute them */

export async function coreWebHareRouter(request: WebRequest): Promise<WebResponse> {
  const target = await lookupPublishedTarget(request.url.toString()); //"Kijkt in database. Haalt file info en publisher info op"
  /* TODO we have to disable this to be able to resolve <backend> webrules.
          ideally we would only forward to the HS Websever if we hit a SHTML
  if (!target) //FIXME avoid new Error - it forces a stacktrace to be generated
    throw new Error("404 Unable to resolve the target. How do we route to a 404?"); //TODO perhaps there should be WebserverError exceptions similar to AbortWithHTTPError - and toplevel routers catch these ?
  */

  if (!target?.renderer) //Looks like we'll need to fallback to the WebHare webserver to handle this request
    return await routeThroughHSWebserver(request);

  //Invoke the render function. TODO seperate VM/ShadowRealm etc
  const renderer: WebHareWHFSRouter = await resourcetools.loadJSFunction<WebHareWHFSRouter>(target.renderer);
  const whfsreq = await buildSiteRequest(request, target.targetObject);
  return await renderer(whfsreq);
}
