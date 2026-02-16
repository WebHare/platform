import { litty } from "@webhare/litty";
import type { ContentBuilderFunction, ContentPageRequest, WebResponse } from "@webhare/router";

export async function renderRTD(request: ContentPageRequest): Promise<WebResponse> {
  const rtddata = await request.getInstance("platform:filetypes.richdocument");
  const page = rtddata.data ? await request.renderRTD(rtddata.data) : litty``;
  return await request.buildWebPage(page);
}

renderRTD satisfies ContentBuilderFunction;
