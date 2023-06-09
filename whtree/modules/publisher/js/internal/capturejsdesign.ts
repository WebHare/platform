import { WebHareWHFSRouter, WebRequest } from "@webhare/router";
import { lookupPublishedTarget } from "@webhare/router/src/corerouter";
import { buildSiteRequest } from "@webhare/router/src/siterequest";
import * as whfs from "@webhare/whfs";
import * as resourcetools from "@mod-system/js/internal/resourcetools";
import { WebResponseInfo } from "@mod-system/js/internal/types";

export async function captureJSDesign(obj: number) {
  //Create a SiteRequest so we have context for a SiteResponse
  const targetdoc = await whfs.openFile(obj);
  const req = new WebRequest(targetdoc.link || "https://www.example.net/");
  const sitereq = await buildSiteRequest(req, targetdoc);

  const outputpage = await sitereq.createComposer();
  const placeholder = "__CAPTUREJSDESIGN__" + Math.random();
  outputpage.appendHTML(placeholder);
  const response = await outputpage.finish();

  return { parts: (await response.text()).split(placeholder) };
}

export async function captureJSPage(obj: number, usecontent?: number): Promise<WebResponseInfo> {
  const targetdoc = await whfs.openFile(obj);
  const req = new WebRequest(targetdoc.link || "https://www.example.net/");
  const target = await lookupPublishedTarget(req.url.toString()); //TODO can't we use 'obj' directly instead of going through a URL lookup?
  if (!target?.renderer)
    throw new Error(`This target does not require a JS renderer`); //can't fallback to HS webserver or we'd risk an infinite loop

  const contentobject = usecontent && usecontent != obj ? await whfs.openFile(usecontent) : target.targetobject;

  const renderer: WebHareWHFSRouter = await resourcetools.loadJSFunction(target.renderer) as WebHareWHFSRouter;
  const whfsreq = await buildSiteRequest(req, target.targetobject, { contentobject });
  const response = await renderer(whfsreq);
  return response.asWebResponseInfo();
}
