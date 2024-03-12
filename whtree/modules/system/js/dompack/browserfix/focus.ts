export function getActiveElement(doc: Document | null): HTMLElement | null {
  return doc?.activeElement as HTMLElement || null;
}

export function getToplevelWindow() {
  let toplevelwindow: Window = window;
  while (toplevelwindow.frameElement)
    toplevelwindow = toplevelwindow.parent;
  return toplevelwindow;
}

export function asIframe(node: Element | null): HTMLIFrameElement | null {
  return node && (node as HTMLElement)?.matches?.('iframe') ? node as HTMLIFrameElement : null;
}

/**
     Find the currently focused element
 *
    @param limitdoc - If set, only return compontents in the specified document (prevents editable iframes from returning subframes)
    @returns The element or null
 */
export function getCurrentlyFocusedElement(limitdoc?: Document): HTMLElement | null {
  try {
    let focused = getActiveElement(getToplevelWindow().document);
    for (; ;) {
      const frame = asIframe(focused);
      if (frame && (!limitdoc || frame.ownerDocument !== limitdoc))
        focused = getActiveElement(frame.contentDocument);
      else
        break;
    }
    if (focused && limitdoc && focused.ownerDocument !== limitdoc)
      return null;
    return focused;
  } catch (e) {
    return null;
  }
}

function getIframeFocusableNodes(currentnode: HTMLIFrameElement, recurseframes: boolean) {
  //ADDME force body into list?
  let subnodes: HTMLElement[] = [];
  try {
    const body = currentnode.contentDocument?.body || currentnode.contentWindow?.document.body || null;
    if (body?.isContentEditable)
      return subnodes;

    subnodes = getFocusableComponents(body, recurseframes);
  } catch (e) {
    console.log("failed to descend into iframe", e);
  }

  return subnodes;
}

/** Return whether the node is reachable for focus by keyboard navigation
   (because tabIndex === -1 will be seen a non(keyboard)focusable by this function)

    @param node - Node to test
    @param ignoreInert - Ignore the inert attribute
*/
export function canFocusTo(node: Element, { ignoreInertAttribute = false } = {}): node is HTMLElement { //returns if a -visible- node is focusable (this function does not check for visibility itself)
  if (!node.closest) //callers are not necessarily calling us with HTMLElement, eg getClosestValidFocusTarget might supply a document
    return false;
  if (!ignoreInertAttribute && node.closest('[inert]'))
    return false;

  if ((node as HTMLElement).contentEditable === "true")
    return true;

  return (node as HTMLElement).tabIndex >= 0 && !(node as HTMLInputElement).disabled && !(node.tagName === 'A' && !(node as HTMLAnchorElement).href);
}

export function getFocusableComponents(startnode: Element | null, recurseframes?: boolean) {
  let focusable: HTMLElement[] = [];
  if (!startnode)
    return focusable;
  for (const currentnode of startnode.children) {
    // Get current style (avoid mootools due to cross-frame issues)
    const currentstyle = getComputedStyle(currentnode);
    if (!currentstyle || currentstyle.display === "none" || currentstyle.visibility === "hidden") {
      //if(currentnode.getStyle) console.log("getFocusableComponents skipping",currentnode, $(currentnode).getStyle("display"), currentnode.getStyle("visibility"))
      continue;
    }

    let iframe;
    if (recurseframes && (iframe = asIframe(currentnode))) { //might contain more things to focus
      const subnodes = getIframeFocusableNodes(iframe, recurseframes);
      if (subnodes.length)
        focusable = focusable.concat(subnodes);
    } else if (canFocusTo(currentnode)) {
      focusable.push(currentnode);
    }

    if ((currentnode as HTMLElement).isContentEditable)
      continue; //don't look for further focusable nodes inside, the whole RTE counts as an editable component

    const subnodes = getFocusableComponents(currentnode, recurseframes);
    if (subnodes.length)
      focusable = focusable.concat(subnodes);
  }
  return focusable;
}

export function getAllFocusableComponents() {
  return getFocusableComponents(getToplevelWindow().document.documentElement, true);
}
