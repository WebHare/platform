import { getTid } from "@webhare/gettid";
import type { SiteRequest, WebResponse } from "@webhare/router";
import { encodeString } from "@webhare/std";

export async function renderJSPage(request: SiteRequest): Promise<WebResponse> {
  return await request.renderHTMLPage(`<p id="gettidtest">${encodeString(getTid("webhare_testsuite:test.testencoding"), "html")}</p>`);
}
