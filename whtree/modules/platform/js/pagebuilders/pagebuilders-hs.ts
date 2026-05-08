import type { WebResponseInfo } from "@mod-system/js/internal/types";
import { rawLitty } from "@webhare/litty";
import { createContentPageRequest } from "@webhare/router";
import { setupRequestFromResult, type RunPageResultContent } from "@webhare/router/src/hswebdesigndriver";
import { openFileOrFolder } from "@webhare/whfs";

export async function runJSDesignForRenderedHSPage(targetId: number, runPageResult: RunPageResultContent): Promise<WebResponseInfo> {
  const target = await openFileOrFolder(targetId);
  const contReq = await createContentPageRequest(target);
  setupRequestFromResult(contReq, runPageResult);

  return (await contReq.buildWebPage(rawLitty(runPageResult.content))).asWebResponseInfo();
}
