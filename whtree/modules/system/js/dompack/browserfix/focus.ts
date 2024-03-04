export function getActiveElement(doc: Document | null): Element | null {
  try {
    //activeElement can reportedly throw on IE9 and _definately_ on IE11
    return doc?.activeElement || null;
  } catch (e) {
    return null;
  }
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
export function getCurrentlyFocusedElement(limitdoc?: Document): Element | null {
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
  let subnodes: Element[] = [];
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

// whether the node is reachable for focus by keyboard navigation
// (because tabIndex === -1 will be seen a non(keyboard)focusable by this function)
// TODO this function should probably be cleaner but you'll be breaking a lot of tests in subtle ways if you change it.
//      well perhaps we don't need to check for "COMMAND" but I've lost any further appetite on cleanup attempts
export function canFocusTo(node: Element) { //returns if a -visible- node is focusable (this function does not check for visibility itself)
  try {
    if ((node as HTMLElement).contentEditable === "true")
      return true;

    // http://dev.w3.org/html5/spec-preview/editing.html#focusable
    if ((node as HTMLElement).tabIndex === -1) //explicitly disabled
      return false;

    return (parseInt(node.getAttribute('tabIndex') || "") >= 0) //we cannot read the property tabIndex directly, as IE <= 8 will return '0' even if the tabIndex is missing
      //even then: a[name] reports tabIndex 0 but has no getAttribute('tabIndex') so be prepared if you try to fix this..
      || (["A", "LINK"].includes(node.nodeName) && (node as HTMLLinkElement).href)
      || (!(node as HTMLInputElement).disabled && (["BUTTON", "SELECT", "TEXTAREA", "COMMAND"].includes(node.nodeName)
        || (node.nodeName === "INPUT" && (node as HTMLInputElement).type !== "hidden")));
  } catch (e) {
    return false; //the code above may fail eg on IE11 if it's a Flash object that'ss still loading
  }
}

export function getFocusableComponents(startnode: Element | null, recurseframes?: boolean) {
  let focusable: Element[] = [];
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
