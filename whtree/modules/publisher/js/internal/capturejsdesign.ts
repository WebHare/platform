import { buildContentPageRequest } from "@webhare/router/src/siterequest";
import * as whfs from "@webhare/whfs";
import type { WebResponseInfo } from "@mod-system/js/internal/types";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { setTidLanguage } from "@webhare/gettid";
import { rawLitty } from "@webhare/litty";

export async function captureJSDesign(obj: number) {
  //Create a SiteRequest so we have context for a SiteResponse
  const targetdoc = await whfs.openFileOrFolder(obj);
  const req = new IncomingWebRequest(targetdoc.link || "https://www.example.net/");
  const sitereq = await buildContentPageRequest(req, targetdoc);

  const placeholder = "__CAPTUREJSDESIGN__" + Math.random();
  const response = await sitereq.buildWebPage(rawLitty(placeholder));

  return { parts: (await response.text()).split(placeholder) };
}

export async function captureJSPage(obj: number, usecontent?: number): Promise<WebResponseInfo> {
  //we are designed to be invoked as a function so we'll arrange for a context ourselves to scope language settings
  await using mycontext = new CodeContext(`captureJSPage ${obj}`);
  return await mycontext.run(async () => {
    const targetdoc = await whfs.openFile(obj);
    const req = new IncomingWebRequest(targetdoc.link || "https://www.example.net/");
    const sitereq = await buildContentPageRequest(req, targetdoc);
    const builder = await sitereq.getPageRenderer();
    if (!builder)
      throw new Error(`This target does not require a JS renderer`); //can't fallback to HS webserver or we'd risk an infinite loop

    setTidLanguage(sitereq.siteLanguage);
    const response = await builder(sitereq);

    return await response.asWebResponseInfo();
  });
}
