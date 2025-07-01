import type { WRDAttributeType } from "./types";
import { nameToSnakeCase, nameToCamelCase } from "@webhare/std/types";

export interface WRDAttributeConfiguration_HS {
  id: number;
  attributetype: number;
  attributetypename: string;
  tag: string;
  title: string;
  checklinks: boolean;
  domain: number;
  isunsafetocopy: boolean;
  isrequired: boolean;
  isordered: boolean;
  isunique: boolean;
  allowedvalues: string[];
}

export interface WRDAttributeConfigurationBase {
  attributeType: WRDAttributeType;
  title?: string;
  checkLinks?: boolean;
  domain?: string | null;
  isUnsafeToCopy?: boolean;
  isRequired?: boolean;
  isOrdered?: boolean;
  isUnique?: boolean;
  allowedValues?: string[] | null;
}

export interface WRDAttributeConfiguration extends WRDAttributeConfigurationBase {
  /// Attribute ID, null if a base attribute
  id: number | null;
  tag: string;
  title: string;
  checkLinks: boolean;
  domain: string | null;
  isUnsafeToCopy: boolean;
  isRequired: boolean;
  isOrdered: boolean;
  isUnique: boolean;
  allowedValues: string[] | null;
}


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
  "wrd_rightentity": "wrdRightEntity"
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

  return nameToCamelCase(tag);
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

  return nameToSnakeCase(tag).toUpperCase();
}

export function checkValidWRDTag(tag: string, options?: { allowMultiLevel?: boolean }): void {
  for (const part of options?.allowMultiLevel ? tag.split('.') : [tag]) {
    if (part[0] === part[0].toUpperCase())
      throw new Error(`A JS WRD name may not start with an uppercase letter: ${part}`);
    if (part.match(/_[a-z]/i))
      throw new Error(`Invalid JS WRD name - are you passing a HareScript tag? (eg WRD_PERSON instead of wrdPerson): ${part}`);

    if (!part.match(/^[a-z][a-zA-Z0-9]*$/))
      throw new Error(`Invalid WRD tag: ${JSON.stringify(part)}. Must be alphanumeric, cannot start with an uppercase character and cannot contain underscores`);
    // A-Z in JS takes up 2 chars in HS to encode ('_' + character)
    const uppercaseCount = part.replace(/[^A-Z]/g, '').length;
    if (part.length + uppercaseCount > 64)
      throw new Error(`Invalid WRD tag: ${JSON.stringify(part)}. Must be at most 64 characters long (with uppercase characters counting as 2 characters)`);
  }
}

export function isValidWRDTag(tag: string): boolean {
  return Boolean(tag.match(/^[A-Z][A-Z0-9_]{0,63}$/) && !tag.endsWith('_'));
}
