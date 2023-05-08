const fixed_tojs: Record<string, string> = {
  "wrd_creationdate": "wrdCreationDate",
  "wrd_limitdate": "wrdLimitDate",
  "wrd_modificationdate": "wrdModificationDate",
  "wrd_dateofbirth": "wrdDateOfBirth",
  "wrd_dateofdeath": "wrdDateOfDeath",
  "wrd_firstname": "wrdFirstName",
  "wrd_firstnames": "wrdFirstNames",
  "wrd_lastname": "wrdLastName",
  "wrd_fullname": "wrdFullName",
  "wrd_orgname": "wrdOrgName",
  "wrd_salute_formal": "wrdSaluteFormal",
  "wrd_address_formal": "wrdAddressFormal",
  "wrd_titles_suffix": "wrdTitlesSuffix",
  "wrd_leftentity": "wrdLeftEntity",
  "wrd_rightentity": "wrdRightEntity",
  "wrd_settingid": "wrdSettingId"
};

const fixed_tohs = Object.fromEntries(Object.entries(fixed_tojs).map(([key, value]) => [value, key.toUpperCase()]));

/**
 * Convert a HS tag (eg WRD_PERSON) to JavaScript (wrdPerson)
 * @param tag - The tag to convert
 */
export function tagToJS(tag: string): string {
  tag = tag.toLowerCase();
  if (fixed_tojs[tag])
    return fixed_tojs[tag];

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
    if (Array.isArray(value) && value.length && typeof value[0] === "object" && value[0]) { // array?
      result[tagToJS(key)] = value.map(elt => fieldsToJS(elt));
    } else if (typeof value === "bigint" && key === "wrdSettingId")
      result[tagToJS(key)] = Number(value);
    else
      result[tagToJS(key)] = value;
  }
  return result;
}

export function fieldsToHS(fields: Record<string, unknown>): Record<string, unknown> {
  //TODO smart recurse into arrays
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value) && value.length && typeof value[0] === "object" && value[0]) { // array?
      result[tagToHS(key)] = value.map(elt => fieldsToHS(elt));
    } else
      result[tagToHS(key)] = value;
  }
  return result;
}

export function outputmapToHS(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "object")
      result[key] = outputmapToHS(value as Record<string, unknown>);
    else
      result[key] = tagToHS(value as string); //FIXME support records
  }
  return result;
}

type RepairMapping = Array<{ key: string; isrecord: false } | { key: string; isrecord: true; subkeys: RepairMapping }>;

function prepareRepair(mapping: Record<string, unknown>): RepairMapping {
  const retval: RepairMapping = [];
  const entries = Object.entries(mapping);
  for (const [key, value] of entries) {
    if (typeof value === "string")
      retval.push({ key, isrecord: false });
    else
      retval.push({ key, isrecord: true, subkeys: prepareRepair(value as Record<string, unknown>) });
  }
  return retval;
}

function repairArray(array: unknown): unknown {
  if (Array.isArray(array) && array.length && typeof array[0] === "object" && array[0]) {
    return array.map(elt => fieldsToJS(elt));
  }
  return array;
}

function repairResultSetInternal(row: Record<string, unknown>, preparedmapping: RepairMapping): Record<string, unknown> {
  const fixedrow = { ...row };
  for (const rec of preparedmapping) {
    if (!(rec.key in fixedrow)) {
      //the key is missing in the outputset. find it case-insensitively to correct it
      const match = Object.keys(fixedrow).find(k => k.toLowerCase() === rec.key.toLowerCase());
      if (!match)
        throw new Error(`Missing key ${rec.key} in output row`);
      let value = fixedrow[match];
      if (rec.isrecord)
        value = repairResultSetInternal(value as Record<string, unknown>, rec.subkeys);
      else if (Array.isArray(value))
        value = repairArray(value);
      fixedrow[rec.key] = value;
      delete fixedrow[match];
    } else if (rec.isrecord) {
      fixedrow[rec.key] = repairResultSetInternal(row[rec.key] as Record<string, unknown>, rec.subkeys);
    } else if (Array.isArray(row[rec.key]))
      fixedrow[rec.key] = repairArray(row[rec.key]);
  }
  return fixedrow;
}

export function repairResultSet(resultset: Array<Record<string, unknown>>, mapping: Record<string, unknown>): Array<Record<string, unknown>> {
  const preparedmapping = prepareRepair(mapping);
  return resultset.map(row => repairResultSetInternal(row, preparedmapping));
}
