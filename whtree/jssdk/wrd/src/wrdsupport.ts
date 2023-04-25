/**
 * Convert a HS tag (eg WRD_PERSON) to JavaScript (wrdPerson)
 * @param tag - The tag to convert
 */
export function tagToJS(tag: string): string {
  tag = tag.toLowerCase();
  tag = tag.replaceAll(/_[a-z]/g, c => c[1].toUpperCase());
  return tag;
}

/**
 * Convert a JS tag (eg wrdPerson) to HS (WRD_PERSON)
 * @param tag - The tag to convert
 */
export function tagToHS(tag: string): string {
  if (tag[0] === tag[0].toUpperCase())
    throw new Error(`A JS WRD name may not start with an uppercase letter: ${tag}`);
  if (tag.match(/_[a-z]/i))
    throw new Error(`Invalid JS WRD name - are you passing a HareScript tag? (eg WRD_PERSON instead of wrdPerson): ${tag}`);

  return tag.replaceAll(/[A-Z]/g, c => '_' + c).toUpperCase();
}
