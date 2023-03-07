import { callHareScript } from "@webhare/services";
import * as whfs from "@webhare/whfs";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { WebHareWHFSRouter, WebRequest, WebResponse, SiteRequest } from "./router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";

export async function lookupPublishedTarget(url: string) {
  //we'll use the HS version for now. rebuilding lookup is complex and we should really port the tests too before we attempt it...
  const lookupresult = await callHareScript("mod::publisher/lib/publisher.whlib#LookupPublisherURL", [url], { openPrimary: true }) as { file: number }; //TODO also send the clientwebserver id
  if (!lookupresult.file)
    return null;

  const fileinfo = await whfs.openFile(lookupresult.file);
  if (!fileinfo)
    return null;

  //TODO also gather webdesign info
  const applytester = await getApplyTesterForObject(fileinfo);
  const renderinfo = await applytester.getObjRenderInfo();

  return {
    lookupresult,
    fileinfo,
    renderer: renderinfo.renderer
  };
}

/* TODO Unsure if this should be a public API of @webhare/router or whether it should be part of the router at all. We risk
        dragging in a lot of dependencies here in the end, and may @webhare/router should only be for apps that implement routes, not execute them */

export async function coreWebHareRouter(request: WebRequest): Promise<WebResponse> {
  const target = await lookupPublishedTarget(request.url.toString()); //"Kijkt in database. Haalt file info en publisher info op"
  if (!target) //FIXME avoid new Error - it forces a stacktrace to be generated
    throw new Error("404 Unable to resolve the target. How do we route to a 404?"); //TODO perhaps there should be WebserverError exceptions similar to AbortWithHTTPError - and toplevel routers catch these ?

  //Invoke the render function. TODO seperate VM/ShadowRealm etc
  if (!target.renderer)
    throw new Error("500 Unspecified render function");

  const renderer: WebHareWHFSRouter = await resourcetools.loadJSFunction(target.renderer) as WebHareWHFSRouter;
  const whfsreq = new SiteRequest(request, target.fileinfo);

  return await renderer(whfsreq);
}
