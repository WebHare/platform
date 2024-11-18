import { getAssetPackBase } from "@mod-platform/js/concepts/frontend";
import type { AuthorModeOptions } from "@mod-publisher/webdesigns/authormode/authormode";
import { getLocal, loadCSS, loadScript } from "@webhare/dompack";
export type { AuthorModeOptions };

/** Load an asset pack
 * @param apname - The asset pack name (eg platform:tollium)
 * @returns A promise resolving to an array containing the assetpack script and CSS nodes
*/
export async function loadAssetPack(apname: string): Promise<void> {
  const basepath = `${getAssetPackBase(apname)}ap.`;
  if (document.querySelector(`script[src$="${CSS.escape(basepath + "mjs")}"`))
    return; //we have it already

  await Promise.all([loadScript(basepath + "mjs", { module: true }), loadCSS(basepath + 'css')]);
}

/** Setup author mode extensions */
export function setupAuthorMode(options?: AuthorModeOptions): void {
  if (typeof window !== "undefined" && window.top === window && getLocal<string>("wh-feedback:accesstoken")?.match(/^[^.]*\.[^.]*\.[^.]*$/)) { //in a browser
    window.whAuthorModeOptions = options;
    void loadAssetPack("platform:authormode"); // load of assetpack is schedule, no need to wait for it
  }
}
