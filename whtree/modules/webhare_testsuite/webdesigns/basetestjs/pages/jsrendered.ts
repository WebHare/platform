import { getTid } from "@webhare/gettid";
import type { ContentPageRequest, WebResponse } from "@webhare/router";
import { litty } from "@webhare/litty";

export async function renderJSPage(request: ContentPageRequest): Promise<WebResponse> {
  return await request.buildWebPage(litty`<p id="gettidtest">${getTid("webhare_testsuite:test.testencoding")}</p>`);

}
