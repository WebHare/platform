import { loadlib } from "@webhare/harescript";
import { WebHareMemoryBlob } from "@webhare/services/src/webhareblob";

export async function rewriteResource(resourcePath: string, text: string): Promise<string | null> {
  const rewriteresult = await loadlib("mod::devkit/lib/rewrite/rewrite.whlib").rewriteFile(resourcePath, WebHareMemoryBlob.from(text));
  if (!rewriteresult.success)
    return null;
  return await rewriteresult.result!.text();
}
