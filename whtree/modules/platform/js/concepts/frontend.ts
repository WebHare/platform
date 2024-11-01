/* @mod-platform/js/concepts/ is for constants, concepts, simple support APIs, but heavily shared stuff
   that we can't find a place for (yet) in the jssdk

  this file holds stuff needed to run or build the frontend */

/** Get base url for assetpacks
 * @param assetpack - assetpack name, like "platform:frontend"
 * @returns The base URL for the assetpack, starting with and ending in a slash
*/
export function getAssetPackBase(assetpack: string) {
  return `/.wh/ea/ap/${assetpack.replace(':', '.')}/`;
}
