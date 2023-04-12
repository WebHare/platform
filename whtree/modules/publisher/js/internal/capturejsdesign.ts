import { WebRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { buildSiteRequest } from "@webhare/router/src/siterequest";
import * as whfs from "@webhare/whfs";

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

export async function captureJSPage(obj: number) {
  const targetdoc = await whfs.openFile(obj);
  const req = new WebRequest(targetdoc.link || "https://www.example.net/");
  const response = await coreWebHareRouter(req);
  return { body: (await response.text()) };
}
