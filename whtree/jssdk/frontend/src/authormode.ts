import { getAssetPackBase } from "@mod-platform/js/concepts/frontend";
import type { AuthorModeOptions } from "@mod-publisher/webdesigns/authormode/authormode";
import { getLocal, loadCSS, loadScript } from "@webhare/dompack";
export type { AuthorModeOptions };

/** Load an asset pack
 * @param apname - The asset pack name (eg tollium:webinterface)
 * @returns A promise resolving to an array containing the assetpack script and CSS nodes
*/
export function loadAssetPack(apname: string) {
  const basepath = `${getAssetPackBase(apname)}ap.`;
  if (document.querySelector(`script[src$="${CSS.escape(basepath + "mjs")}"`))
    return; //we have it already

  return Promise.all([loadScript(basepath + "mjs", { module: true }), loadCSS(basepath + 'css')]);
}

/** Setup author mode extensions */
export function setupAuthorMode(options?: AuthorModeOptions) {
  if (typeof window !== "undefined" && window.top === window && getLocal<string>("wh-feedback:accesstoken")?.match(/^[^.]*\.[^.]*\.[^.]*$/)) { //in a browser
    window.whAuthorModeOptions = options;
    loadAssetPack("publisher.authormode");
  }
}
