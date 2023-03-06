import { SiteRequest, WebRequest, HTTPMethod } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import * as whfs from "@webhare/whfs";

export async function captureJSDesign(obj: number) {
  //Create a SiteRequest so we have context for a SiteResponse
  const targetdoc = await whfs.openFile(obj);
  const req = new WebRequest(HTTPMethod.GET, targetdoc.link, new Headers, "");
  const sitereq = new SiteRequest(req, targetdoc);

  const outputpage = await sitereq.createComposer();
  const placeholder = "__CAPTUREJSDESIGN__" + Math.random();
  outputpage.appendHTML(placeholder);
  const response = await outputpage.finish();

  return { parts: response.body.split(placeholder) };
}

export async function captureJSPage(obj: number) {
  const targetdoc = await whfs.openFile(obj);
  const req = new WebRequest(HTTPMethod.GET, targetdoc.link, new Headers, "");
  const response = await coreWebHareRouter(req);
  return { body: response.body };
}
