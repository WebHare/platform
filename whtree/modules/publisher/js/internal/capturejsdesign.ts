import type { WebHareWHFSRouter } from "@webhare/router";
import { lookupPublishedTarget } from "@webhare/router/src/corerouter";
import { buildSiteRequest } from "@webhare/router/src/siterequest";
import * as whfs from "@webhare/whfs";
import type { WebResponseInfo } from "@mod-system/js/internal/types";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { setTidLanguage } from "@webhare/gettid";
import { loadJSFunction } from "@webhare/services";

export async function captureJSDesign(obj: number) {
  //Create a SiteRequest so we have context for a SiteResponse
  const targetdoc = await whfs.openFileOrFolder(obj);
  const req = new IncomingWebRequest(targetdoc.link || "https://www.example.net/");
  const sitereq = await buildSiteRequest(req, targetdoc);

  const outputpage = await sitereq.createComposer({ __captureJSDesign: true });
  const placeholder = "__CAPTUREJSDESIGN__" + Math.random();
  outputpage.appendHTML(placeholder);
  const response = await outputpage.finish();

  return { parts: (await response.text()).split(placeholder) };
}

export async function captureJSPage(obj: number, usecontent?: number): Promise<WebResponseInfo> {
  //we are designed to be invoked as a function so we'll arrange for a context ourselves to scope language settings
  await using mycontext = new CodeContext(`captureJSPage ${obj}`);
  return await mycontext.run(async () => {
    const targetdoc = await whfs.openFile(obj);
    const req = new IncomingWebRequest(targetdoc.link || "https://www.example.net/");
    const target = await lookupPublishedTarget(req.url.toString()); //TODO can't we use 'obj' directly instead of going through a URL lookup?
    if (!target?.renderer)
      throw new Error(`This target does not require a JS renderer`); //can't fallback to HS webserver or we'd risk an infinite loop

    const contentObject = usecontent && usecontent !== obj ? await whfs.openFile(usecontent) : target.targetObject;

    const renderer: WebHareWHFSRouter = await loadJSFunction<WebHareWHFSRouter>(target.renderer);
    const whfsreq = await buildSiteRequest(req, target.targetObject, { contentObject });
    setTidLanguage(await whfsreq.getSiteLanguage());
    const response = await renderer(whfsreq);
    return await response.asWebResponseInfo();
  });
}
