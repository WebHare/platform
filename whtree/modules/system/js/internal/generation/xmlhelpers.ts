/* TODO These APIs are potential hscompat candidates? As the whole idea of XML support is HSCompat...
*/

import { isTruthy } from "../util/algorithms";

export function elements<T extends Element>(collection: HTMLCollectionOf<T>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    items.push(collection[i]);
  return items;
}

function parseXSList(input: string | null): string[] {
  if (!input)
    return [];

  return input.replaceAll(/\s+/g, ' ').split(' ').filter(isTruthy);
}

/** getAttr wrapper with fallback if attribute is missing. We can't rely on getAttribute ?? fallback as not all
 * DOM implementations actually return a null for a missing attribute. We only support string[] for xs:list
 * as JavaScript can't realyl differentiate between arrays of different types. Fortunately non-string arrays are
 * rare in WebHare's XML formats
*/
export function getAttr(node: Element, attr: string): string;
export function getAttr(node: Element, attr: string, fallback: string[]): string[];
export function getAttr(node: Element, attr: string, fallback: number): number;
export function getAttr(node: Element, attr: string, fallback: boolean): boolean;
export function getAttr(node: Element, attr: string, fallback: string): string;

export function getAttr<T>(node: Element, attr: string, fallback: T = "" as T): T {
  //TODO it would be nice if we could work without as T but the default value is preventing that
  const attrval: string | null = node.getAttribute(attr);
  if (attrval === null || (!attrval && !node.hasAttribute(attr)))
    return (fallback ?? "") as T;
  if (typeof fallback === 'boolean')
    return ["1", "true"].includes(attrval) as T;
  if (typeof fallback === 'number')
    return parseInt(attrval) as T;
  if (Array.isArray(fallback))
    return parseXSList(attrval) as T;
  return attrval as T;
}
