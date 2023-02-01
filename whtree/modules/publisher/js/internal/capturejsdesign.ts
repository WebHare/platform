import { SiteRequest, WebRequest, WebResponse } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import * as whfs from "@webhare/whfs";

export async function captureJSDesign(obj: number) {
  //Create a SiteRequest so we have context for a SiteResponse
  const targetdoc = await whfs.openFile(obj);
  const sitereq = new SiteRequest(new WebRequest("GET", targetdoc.link), targetdoc);

  const response = new WebResponse;
  const outputpage = await sitereq.createComposer(response);
  const placeholder = "__CAPTUREJSDESIGN__" + Math.random();
  outputpage.appendHTML(placeholder);
  await outputpage.finish();

  return { parts: response.body.split(placeholder) };
}

export async function captureJSPage(obj: number) {
  const targetdoc = await whfs.openFile(obj);
  const response = new WebResponse;
  await coreWebHareRouter(new WebRequest("GET", targetdoc.link), response);
  return { body: response.body };
}
