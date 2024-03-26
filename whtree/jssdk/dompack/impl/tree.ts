/** Elements you can set a value on and would have to trigger change and/or input events */
export type FormControlElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function qS<E extends Element = HTMLElement>(startnode: ParentNode, selector: string): E | null;
export function qS<E extends Element = HTMLElement>(selector: string): E | null;

/** Match the first element using a CSS selector
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The first matching element or null
 */
export function qS<E extends Element>(node_or_selector: ParentNode | string, selector?: string): E | null {
  if (typeof node_or_selector === 'string')
    return document.querySelector<E>(node_or_selector);
  else if (selector)
    return node_or_selector.querySelector<E>(selector);
  return null;
}


export function qR<E extends Element = HTMLElement>(startnode: ParentNode, selector: string): E;
export function qR<E extends Element = HTMLElement>(selector: string): E;

/** Match a specific element using a CSS selector, requiring it to exist and be unique
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The requested element. Throw it the selector doesn't match exactly one element
 */
export function qR<E extends Element>(node_or_selector: ParentNode | string, selector?: string): E {
  const matches = qSA<E>(node_or_selector as ParentNode, selector as string);
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

export function qSA<E extends Element = HTMLElement>(startnode: ParentNode, selector: string): E[];
export function qSA<E extends Element = HTMLElement>(selector: string): E[];

/** Find multiple elements using a CSS selector
 * @param node_or_selector - The starting node or selector
 * @param selector - The selector to match if the starting node was specified
 * @returns The requested elements.
 */
export function qSA<E extends Element>(node_or_selector: ParentNode | string, selector?: string): E[] {
  if (typeof node_or_selector === 'string')
    return Array.from(document.querySelectorAll(node_or_selector));
  else if (selector)
    return Array.from(node_or_selector.querySelectorAll(selector));

  return [];
}

/** Return whether the passed element is a FormControlElement */
export function isFormControl(field: Element): field is FormControlElement {
  return field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement;
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
  return Boolean("ownerDocument" in node && node.constructor.name.match(/Element$/));
}

/** Test whether node is a HTMLElement, even if it's in a different iframe */
export function isHTMLElement(node: unknown): node is HTMLElement {
  return isElement(node) && "accessKey" in node;
}
