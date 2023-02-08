/** Create a regular expression from a string with DOS-like wildcards (? and *)
 * @param mask - Mask with '?' and/or '*' wildcards
 * @returns Regular expression string which can be passed to new RegExp
*/
export function wildcardsToRegExp(mask: string): string {
  mask = mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  mask = mask.replaceAll("\\*", ".*");
  mask = mask.replaceAll("\\?", ".");
  return mask;
}
