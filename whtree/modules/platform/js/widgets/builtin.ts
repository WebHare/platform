import type { PagePartRequest } from "@webhare/router";
import type { TypedInstanceData } from "@webhare/whfs";
import { rawLitty } from "@webhare/litty";

export async function renderHTMLWidget(request: PagePartRequest, data: TypedInstanceData<"platform:widgets.html">) {
  //FIXME preview
  return rawLitty(data.html);
}
