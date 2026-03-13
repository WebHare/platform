import { getTid } from "@webhare/gettid";
import type { ContentPageRequest, WebResponse } from "@webhare/router";
import { litty } from "@webhare/litty";

export async function renderJSPage(request: ContentPageRequest): Promise<WebResponse> {
  return await request.buildWebPage(litty`<p id="gettidtest">${getTid("webhare_testsuite:test.testencoding")}</p>`);
}

export async function renderDynamicPage(request: ContentPageRequest): Promise<WebResponse> {
  if (!request.webRequest)
    throw new Error(`renderDynamicPage didn't see a webRequest object`);

  const url = new URL(request.webRequest.url);
  return await request.buildWebPage(litty`<p>renderDynamicPage(echo = ${url.searchParams.get("echo") || ''})</p>`);
}
