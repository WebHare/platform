/* TODO These APIs are potential hscompat candidates? As the whole idea of XML support is HSCompat...
*/

import type { ModuleQualifiedName } from "@webhare/services/src/naming";
import { isAbsoluteResource, parseResourcePath } from "@webhare/services/src/resources";
import { isTruthy } from "@webhare/std";
import { DOMParser, type Document, type Node, type Element, type NodeList } from "@xmldom/xmldom";

/** Build a \@xmldom/xmldom DOCParser that doesn't make noise about broken docs */
export function parseDocAsXML(data: string, format: "text/xml" | "text/html"): Document {
  const parser = new DOMParser({
    onError: w => { } //just ignore
  });

  if (data.startsWith("\uFEFF")) //UTF8 BOM - parseFromString can't handle that so remove it
    data = data.substring(1);

  return parser.parseFromString(data, format);
}

export function elements<T extends Element>(collection: NodeList<Node>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    if (collection[i].nodeType === collection[i].ELEMENT_NODE)
      items.push(collection[i] as T);
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

export function getQualifiedAttr(defaultmodule: string, node: Element, attr: string): ModuleQualifiedName | null {
  let val = getAttr(node, attr, "");
  if (val && !val.includes(':'))
    val = `${defaultmodule}:${val}`;
  return val as ModuleQualifiedName | null;
}

function isAbsoluteTid(tid: string) {
  return tid.includes(':') || tid.startsWith('~');
}

function getXMLTidFromName(defaultmodule: string, currentgid: string, el: Element) {
  for (const attr of ["cellname", "name"]) {
    if (el.hasAttribute(attr)) {
      let name = el.getAttribute(attr)!.toLowerCase();
      name = name.substring(name.lastIndexOf('.') + 1);
      if (currentgid.includes(':'))
        return { attr, tid: currentgid + '.' + name };
      if (!defaultmodule)
        throw new Error(`ParseXMLTidPtr requires a set module for automatic ${attr}-based titles if the gid doesn't specify one`);
      return { attr, tid: defaultmodule + ':' + currentgid + '.' + name };
    }
  }
  return null;
}


/** Parse a title/tid combination, considering any groupid, default module and name/cellname rules. Returns an empty string if unset, ':' prefixed string for untranslated texts, and otherwise a module:tid combination
 */
export function parseXMLTidPtr(resourcename: string, currentgid: string, el: Element, attrname: string) {
  return parseXMLTidPtrNS(resourcename, currentgid, el, null, attrname, false);
}

export function parseXMLTidPtrNS(resourcename: string, currentgid: string, el: Element, ns: string | null, attrname: string, richtid: boolean) {
  if (!isAbsoluteResource(resourcename))
    throw new Error(`parseXMLTidPtr call with invalid resource name '${resourcename}'`);

  const attrnametid = attrname.endsWith("title") ? attrname.slice(0, -5) + "tid" : attrname + "tid";
  if (el.hasAttributeNS(ns, attrnametid)) {
    const tid = el.getAttributeNS(ns, attrnametid) || '';
    if (tid.startsWith('.'))
      return currentgid + tid;
    if (!isAbsoluteTid(tid)) {
      const module = parseResourcePath(resourcename)?.module;
      if (module)
        return `${module}:${tid}`;
    }
    /* TODO?  tid logging through parsexmltidptr?
    IF(onparsedtid !== DEFAULT MACRO PTR)
    {
      STRING ARRAY conflicting_attributes; //do we have both tid= and one of title/htmltitle ?
      IF(el -> HasAttributeNS(ns, "html" || attrname))
        INSERT "html" || attrname INTO conflicting_attributes AT END;
      IF(el -> HasAttributeNS(ns, attrname))
        INSERT attrname INTO conflicting_attributes AT END;
      onparsedtid(CELL[resourcename, tid, line := el -> linenum, col := 0, attrname := attrnametid, conflicting_attributes ]);
    }*/

    return tid;
  }
  if (richtid && el.hasAttributeNS(ns, "html" + attrname))
    return "<>" + el.getAttributeNS(ns, "html" + attrname);

  if (el.hasAttributeNS(ns, attrname))
    return ":" + el.getAttributeNS(ns, attrname);
  if (currentgid && attrname.endsWith("title")) {
    const module = parseResourcePath(resourcename)?.module;
    if (module) {
      const trygidfromname = getXMLTidFromName(module, currentgid, el);
      if (trygidfromname) {
        /* TODO?  tid logging through parsexmltidptr?
        IF(onparsedtid !== DEFAULT MACRO PTR AND trygidfromname.tid !== "")
          onparsedtid(CELL[resourcename, trygidfromname.tid, line := el -> linenum, col := 0, attrname := trygidfromname.attr, conflicting_attributes := STRING[] ]);*/

        return trygidfromname.tid;
      }
    }
  }
  return '';
}

export function determineNodeGid(resourcename: string, node: Node | null): string {
  while (node && node.nodeType === node.ELEMENT_NODE) {
    const localgid = (node as Element).getAttribute("gid");
    if (!localgid) {
      node = node.parentNode;
      continue;
    }
    if (localgid.includes(":")) //absolute
      return localgid;
    if (localgid.startsWith(".")) {
      const parentgid = determineNodeGid(resourcename, node.parentNode);
      if (parentgid)
        return parentgid + localgid;
    }
    const module = parseResourcePath(resourcename)?.module;
    return module ? `${module}:${localgid}` : '';
  }
  return '';
}
