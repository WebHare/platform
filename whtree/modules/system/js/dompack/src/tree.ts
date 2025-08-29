
/* Regex to identify dimensionless style sttributes. copied from old version of preact/src/constants.js (MIT)
   meant to capture:
  { boxFlex:1, boxFlexGroup:1, columnCount:1, fillOpacity:1, flex:1, flexGrow:1,
    flexPositive:1, flexShrink:1, flexNegative:1, fontWeight:1, lineClamp:1, lineHeight:1,
    opacity:1, order:1, orphans:1, strokeOpacity:1, widows:1, zIndex:1, zoom:1
*/
const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|ows|mnc|ntw|ine[ch]|zoo|^ord/i;

export { qS, qSA } from '@webhare/dompack/src/tree.ts';

function generateInsertList(nodes: Array<string | Node>) {
  if (nodes.length === 1)
    return typeof nodes[0] === 'string' ? document.createTextNode(nodes[0]) : nodes[0];

  const frag = document.createDocumentFragment();
  nodes.forEach(node => frag.appendChild(typeof node === 'string' ? document.createTextNode(node) : node));
  return frag;
}

/** @deprecated Use node.matches() */
export function matches(node: Element, selector: string): boolean {
  //only invoke 'matches' if it exists. it *should* but past versions of dompack.matches would check for it too (and thus not fail if you passed in a string instead of a Node)
  return node.matches?.(selector);
}
/** @deprecated Use node.closest() */
export function closest(node: Element, selector: string) {
  if (node.closest)
    return node.closest(selector);
  //TODO: Warn about out-of-date browser?
  let testNode: Element | null = node;
  for (; testNode && !matches(testNode, selector); testNode = testNode.parentElement)
    /*iterate*/;
  return testNode;
}
//implements contains. TODO we only really need this on IE11, which doesn't consider a text node a child, we can probably fall back to native elsewhere ?
/** @deprecated Use node.contains() */
export function contains(ancestor: Node, child: Node) {
  if (ancestor.contains)
    return ancestor.contains(child);
  //TODO: Warn about out-of-date browser?
  for (let testNode: Node | null = child; testNode; testNode = testNode.parentNode)
    if (testNode === ancestor)
      return true;
  return false;
}
//insert a range of nodes before a node: https://dom.spec.whatwg.org/#dom-childnode-before
/** @deprecated Use node.before() */
export function before(node: ChildNode, ...nodes: Array<string | Node>) {
  if (node.before) {
    node.before(...nodes);
    return;
  }
  //TODO: Warn about out-of-date browser?
  if (node.parentNode)
    node.parentNode.insertBefore(generateInsertList(nodes), node);
}
//insert a range of nodes after a node: https://dom.spec.whatwg.org/#dom-childnode-after
/** @deprecated Use node.after() */
export function after(node: ChildNode, ...nodes: Array<string | Node>) {
  if (node.after) {
    node.after(...nodes);
    return;
  }
  //TODO: Warn about out-of-date browser?
  if (node.parentNode)
    node.parentNode.insertBefore(generateInsertList(nodes), node.nextSibling);
}
//replace node with a set of nodes : https://dom.spec.whatwg.org/#dom-childnode-replacewith
/** @deprecated Use node.replaceWith() */
export function replaceWith(node: ChildNode, ...nodes: Array<string | Node>) {
  if (node.replaceWith) {
    node.replaceWith(...nodes);
    return;
  }
  //TODO: Warn about out-of-date browser?
  if (node.parentNode)
    node.parentNode.replaceChild(generateInsertList(nodes), node);
}
//remove node with a set of nodes : https://dom.spec.whatwg.org/#dom-childnode-remove
/** @deprecated Use node.remove() */
export function remove(node: ChildNode) {
  if (node.remove) {
    node.remove();
    return;
  }
  //TODO: Warn about out-of-date browser?
  if (node.parentNode)
    node.parentNode.removeChild(node);
}
//insert nodes at start: https://dom.spec.whatwg.org/#dom-parentnode-prepend
/** @deprecated Use node.prepend() */
export function prepend(node: ParentNode, ...nodes: Array<string | Node>) {
  if (node.prepend) {
    node.prepend(...nodes);
    return;
  }
  //TODO: Warn about out-of-date browser?
  node.insertBefore(generateInsertList(nodes), node.firstChild);
}
//insert nodes at end: https://dom.spec.whatwg.org/#dom-parentnode-append
/** @deprecated Use node.append() */
export function append(node: ParentNode, ...nodes: Array<string | Node>) {
  if (node.append) {
    node.append(...nodes);
    return;
  }
  //TODO: Warn about out-of-date browser?
  node.appendChild(generateInsertList(nodes));
}

/**
 * Toggle a single class
 *
 * @param node - Node to modify
 * @param classname - Class to toggle
 * @param settoggle - true to enable, false to disable, undefined to toggle
 * @deprecated Just use classList.toggle on the node itself
 */
/** @deprecated Use classList.toggle() */
export function toggleClass(node: Element, classname: string, settoggle?: boolean) {
  if (arguments.length === 2) //in old dompack, 2 argument version toggled and 3 argument version toggled off. match that behavior
    node.classList.toggle(classname);
  else
    node.classList.toggle(classname, settoggle);
}

/**
     Toggle classes in a node
 *
    @param node - Node which classes to toggle
    @param toggles - Object, all keys will be added/removed based on the truthyness of their values
 */
export function toggleClasses(node: Element, toggles: { [key: string]: boolean }) {
  if (typeof (toggles) !== "object")
    throw new Error("Expected an object with keys as classnames");
  Object.keys(toggles).forEach(key => node.classList[toggles[key] ? "add" : "remove"](key));
}

/* remove the contents of an existing node */
/** @deprecated Use node.replaceChildren() */
export function empty(node: Element) {
  if (node.replaceChildren) {
    node.replaceChildren();
    return;
  }
  //TODO: Warn about out-of-date browser?
  while (node.lastChild)
    node.removeChild(node.lastChild);
}

export function isDomReady() {
  //ensure no domready events can run if there will never be a dom
  return typeof document !== "undefined" && (document.readyState === "interactive" || document.readyState === "complete");
}

/* run the specified function 'on ready'. adds to DOMContentLoaded if dom is not ready yet. Exceptions/rejections from the ready handler will not be fatal to the rest of code execution */
export function onDomReady(callback: () => void | Promise<void>) {
  if (isDomReady()) {
    try {
      void callback(); //Ignore unhandled rejections
    } catch (e) { // We don't want our caller to 'stop' due to a domready exception as its usually the toplevel initialization code, so log the exception ourselves
      void Promise.reject(new Error("Synchronous onDomReady handler failed", { cause: e })); //Let it propagate as a standard unhandled rejection
    }
  } else
    document.addEventListener("DOMContentLoaded", () => void callback());
}

//parse JSON data, throw with more info on parse failure
export function getJSONAttribute<T>(node: Element, attributename: string): T | null {
  try {
    if (node.hasAttribute(attributename))
      return JSON.parse(node.getAttribute(attributename) as string);
  } catch (e) {
    console.error("JSON parse failure on attribute '" + attributename + "' of node", node);
    throw e;
  }
  return null;
}

/**
     Get the base URI of the current document. IE11 doesn't implement document.baseURI
 *
    @param doc - Document to query. Defaults to window.document
    @deprecated Use document.baseURI
 */
export function getBaseURI(doc: Document | undefined) {
  if (!doc)
    doc = window.document;
  if (doc.baseURI)
    return doc.baseURI;

  const base = doc.querySelector('base');
  if (base && base.href)
    return base.href;
  return doc.URL;
}

/**
     Sets multiple styles on a node, automatically adding 'px' to numbers when appropriate
    (can be used as replacement for Mootools .setStyles)
 *
 * @param node - Node to update
 * @param value - Styles to set
 */
export function setStyles(node: HTMLElement, value?: string | { [key: string]: string | number }) {
  if (!value)
    node.style.cssText = '';
  else if (typeof value === 'string')
    node.style.cssText = value || '';
  else {
    for (const [key, propvalue] of Object.entries(value)) {
      // for numbers, add 'px' if the constant isn't dimensionless (eg zIndex)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we don't know which keys will be set
      (node.style as any)[key] = typeof value[key] === 'number' && IS_NON_DIMENSIONAL.test(key) === false
        ? propvalue + 'px'
        : propvalue;
    }
  }
}
