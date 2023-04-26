const fixed_tojs: Record<string, string> = {
  "WRD_CREATIONDATE": "wrdCreationDate",
  "WRD_LIMITDATE": "wrdLimitDate",
  "WRD_MODIFICATIONDATE": "wrdModificationDate",
  "WRD_DATEOFBIRTH": "wrdDateOfBirth",
  "WRD_DATEOFDEATH": "wrdDateOfDeath",
  "WRD_FIRSTNAME": "wrdFirstName",
  "WRD_FIRSTNAMES": "wrdFirstNames",
  "WRD_LASTNAME": "wrdLastName",
  "WRD_FULLNAME": "wrdFullName",
  "WRD_ORGNAME": "wrdOrgName",
  "WRD_SALUTE_FORMAL": "wrdSaluteFormal",
  "WRD_ADDRESS_FORMAL": "wrdAddressFormal",
  "WRD_TITLES_SUFFIX": "wrdTitlesSuffix",
  "WRD_LEFTENTITY": "wrdLeftEntity",
  "WRD_RIGHTENTITY": "wrdRightEntity"
};

const fixed_tohs = Object.fromEntries(Object.entries(fixed_tojs).map(([key, value]) => [value, key]));

/**
 * Convert a HS tag (eg WRD_PERSON) to JavaScript (wrdPerson)
 * @param tag - The tag to convert
 */
export function tagToJS(tag: string): string {
  if (fixed_tojs[tag])
    return fixed_tojs[tag];

  tag = tag.toLowerCase();
  tag = tag.replaceAll(/_[a-z]/g, c => c[1].toUpperCase());
  return tag;
}

/**
 * Convert a JS tag (eg wrdPerson) to HS (WRD_PERSON)
 * @param tag - The tag to convert
 */
export function tagToHS(tag: string): string {
  if (fixed_tohs[tag])
    return fixed_tohs[tag];

  if (tag[0] === tag[0].toUpperCase())
    throw new Error(`A JS WRD name may not start with an uppercase letter: ${tag}`);
  if (tag.match(/_[a-z]/i))
    throw new Error(`Invalid JS WRD name - are you passing a HareScript tag? (eg WRD_PERSON instead of wrdPerson): ${tag}`);

  return tag.replaceAll(/[A-Z]/g, c => '_' + c).toUpperCase();
}

export function fieldsToJS(fields: Record<string, unknown>): Record<string, unknown> {
  //TODO smart recurse into arrays
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[tagToJS(key)] = value;
  }
  return result;
}

export function fieldsToHS(fields: Record<string, unknown>): Record<string, unknown> {
  //TODO smart recurse into arrays
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[tagToHS(key)] = value;
  }
  return result;
}

export function outputmapToHS(fields: Record<string, unknown>): Record<string, unknown> {
  //TODO smart recurse into arrays
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = tagToHS(value as string); //FIXME support records
  }
  return result;
}

export function repairResultSet(resultset: Array<Record<string, unknown>>, mapping: Record<string, unknown>): Array<Record<string, unknown>> {
  const final: Array<Record<string, unknown>> = [];
  const validkeys = Object.keys(mapping);
  for (const row of resultset) {
    const fixedrow = { ...row };
    for (const key of validkeys) {
      if (!(key in fixedrow)) {
        //the key is missing in the outputset. find it case-insensitively to correct it
        const match = Object.keys(fixedrow).find(k => k.toLowerCase() === key.toLowerCase());
        if (!match)
          throw new Error(`Missing key ${key} in output row`);
        fixedrow[key] = fixedrow[match];
        delete fixedrow[match];
      }
    }
    final.push(fixedrow);
  }
  return final;
}
