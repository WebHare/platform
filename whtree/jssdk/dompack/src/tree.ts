/** Rect describing an elements position */
export type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

/** Elements you can set a value on and would have to trigger change and/or input events */
export type FormControlElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Types that support querySelector(All) */
type QuerySelectorAble = ParentNode | ShadowRoot;

export function qS<E extends Element = HTMLElement>(startnode: QuerySelectorAble, selector: string): E | null;
export function qS<E extends Element = HTMLElement>(selector: string): E | null;

/** Match the first element using a CSS selector
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The first matching element or null
 */
export function qS<E extends Element>(node_or_selector: QuerySelectorAble | string, selector?: string): E | null {
  if (typeof node_or_selector === 'string')
    return document.querySelector<E>(node_or_selector);
  else if (selector)
    return node_or_selector.querySelector<E>(selector);
  return null;
}


export function qR<E extends Element = HTMLElement>(startnode: QuerySelectorAble, selector: string): E;
export function qR<E extends Element = HTMLElement>(selector: string): E;

/** Match a specific element using a CSS selector, requiring it to exist and be unique
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The requested element. Throw it the selector doesn't match exactly one element
 */
export function qR<E extends Element>(node_or_selector: QuerySelectorAble | string, selector?: string): E {
  const matches = qSA<E>(node_or_selector as QuerySelectorAble, selector as string);
  if (matches.length === 1)
    return matches[0];

  if (typeof node_or_selector !== 'string') {
    console.error(`${matches.length} elements match selector \`${selector}\` with startingpoint`, node_or_selector, matches);
    throw new Error(`${matches.length} elements match selector \`${selector}\` given startingpoint '${node_or_selector.nodeName}'`);
  } else {
    console.error(`${matches.length} elements match selector \`${node_or_selector}\` in the document`, matches);
    throw new Error(`${matches.length} elements match selector \`${node_or_selector}\` in the document`);
  }
}

export function qSA<E extends Element = HTMLElement>(startnode: QuerySelectorAble, selector: string): E[];
export function qSA<E extends Element = HTMLElement>(selector: string): E[];

/** Find multiple elements using a CSS selector
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The requested elements.
 */
export function qSA<E extends Element>(node_or_selector: QuerySelectorAble | string, selector?: string): E[] {
  if (typeof node_or_selector === 'string')
    return Array.from(document.querySelectorAll(node_or_selector));
  else if (selector)
    return Array.from(node_or_selector.querySelectorAll(selector));

  return [];
}

/** Return whether the passed element is a FormControlElement */
export function isFormControl(field: Element): field is FormControlElement {
  return isHTMLElement(field) && ["INPUT", "SELECT", "TEXTAREA"].includes(field.tagName);
}

/** Return whether the passed element is an editable text field */
export function isEditControl(field: Element): field is HTMLElement {
  return isHTMLElement(field) && (["INPUT", "TEXTAREA"].includes(field.tagName) || field.isContentEditable);
}

/** Test whether node is an Element, even if it's in a different iframe */
export function isElement(node: unknown): node is Element {
  //TODO What is actually going on if defaultView is missing?
  if (!node || typeof node !== "object")
    return false;

  /* Getting the proto doesn't always work:
  const proto = (node as Element).ownerDocument.defaultView?.Element;
  (because our iframes derive off about? not sure) so until someone finds the real answer, we'll do a heuristic
  */

  /** Analyzing node.constructor.name doesn't work because custom elements don't necessarily have their constructor's name ending in Element
  return Boolean("ownerDocument" in node && node.constructor.name.match(/Element$/));
  */

  return Boolean("ownerDocument" in node && (node as Element).nodeType === 1);

}

/** Test whether node is a HTMLElement, even if it's in a different iframe */
export function isHTMLElement(node: unknown): node is HTMLElement {
  return isElement(node) && "accessKey" in node;
}

/**
 * get the relative bound difference between two elements, and return a writable copy
 *
 * @param node - The node for which you need coordinates
 * @param relativeto - Optional reference point. If not set, you just get a 'normal' coordinate object
 */
export function getRelativeBounds(node: Element, relativeto?: Element): Rect {
  if (!relativeto)
    relativeto = node.ownerDocument.documentElement;

  const nodecoords = node.getBoundingClientRect();
  const relcoords = relativeto.getBoundingClientRect();
  return {
    top: nodecoords.top - relcoords.top,
    left: nodecoords.left - relcoords.left,
    right: nodecoords.right - relcoords.left,
    bottom: nodecoords.bottom - relcoords.top,
    width: nodecoords.width,
    height: nodecoords.height
  };
}

export type ParsedLanguageTag = {
  /** The full tag, eg en-US */
  tag: string;
  /** The language code, eg 'en' */
  language: string;
  region?: string;
  /** The script, eg 'Hant' */
  script?: string;
};

/** Parse a BCP47 language tag */
export function parseLanguageTag(languageTag: string): ParsedLanguageTag {
  /* https://datatracker.ietf.org/doc/html/rfc5646#section-2.1
     langtag       = language
                 ["-" script]
                 ["-" region]
                 *("-" variant)
                 *("-" extension)
                 ["-" privateuse]
     BUT: we're limiting ourselves to language, script an region for now

     language      = 2*3ALPHA           ; shortest ISO 639 code
                    ["-" extlang]       ; sometimes followed by
                                          extended language subtags

                                           extlang       = 3ALPHA              ; selected ISO 639 codes
                 *2("-" 3ALPHA)      ; permanently reserved

      script        = 4ALPHA              ; ISO 15924 code

      region        = 2ALPHA              ; ISO 3166-1 code
                    / 3DIGIT              ; UN M.49 code

     Note that we're not yet fully implementing the spec, just the parts we expect to encounter in practice
  */
  const match = languageTag.match(/^([a-z]{2,}(-[a-z]{3})?)(-[A-Za-z]{4,})?(-[A-Z]{2}|-\d{3})?$/);
  if (!match)
    throw new Error(`Invalid language tag: ${languageTag}`);

  return {
    tag: languageTag,
    language: match[1],
    ...(match[3] ? { script: match[3].substring(1) } : {}),
    ...(match[4] ? { region: match[4].substring(1) } : {})
  };
}

/** Get the effective language for an element (or the document)
 * @param node - The element for which to get the effective language. If not specified, the documentElement and finally the browser is used
 * @returns The language code, eg. "nl" or "en-GB"
 */
export function getLang(node?: Element): ParsedLanguageTag {
  if (!node && typeof document !== "undefined")
    node = document.documentElement;
  const tag = (node?.closest('[lang]')?.getAttribute("lang") || navigator.language || "en");
  return parseLanguageTag(tag);
}
