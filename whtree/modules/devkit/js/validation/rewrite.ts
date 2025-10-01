import { loadlib } from "@webhare/harescript";
import { WebHareMemoryBlob, type WebHareBlob } from "@webhare/services/src/webhareblob";

declare module "@webhare/harescript/src/commonlibs" {
  interface CommonLibraries {
    "mod::devkit/lib/rewrite/rewrite.whlib": {
      rewriteFile(resourcename: string, input: WebHareBlob): Promise<{ success: boolean; result?: WebHareBlob }>;
    };
  }
}

export async function rewriteResource(resourcePath: string, text: string): Promise<string | null> {
  const rewriteresult = await loadlib("mod::devkit/lib/rewrite/rewrite.whlib").rewriteFile(resourcePath, WebHareMemoryBlob.from(text));
  if (!rewriteresult.success)
    return null;
  return await rewriteresult.result!.text();
}
