/** @import: import * as domfocus from 'dompack/browserfix/focus';
*/

export function getActiveElement(doc: Document | null)
{
  try
  {
    //activeElement can reportedly throw on IE9 and _definately_ on IE11
    return doc?.activeElement || null;
  }
  catch(e)
  {
    return null;
  }
}

export function getToplevelWindow()
{
  let toplevelwindow: Window = window;
  while(toplevelwindow.frameElement)
    toplevelwindow = toplevelwindow.parent;
  return toplevelwindow;
}

export function asIframe(node: Element | null) : HTMLIFrameElement | null
{
  return node && (node as HTMLElement)?.matches?.('iframe') ? node as HTMLIFrameElement : null;
}

/** Find the currently focused element
    @param limitdoc If set, only return compontents in the specified document (prevents editable iframes from returning subframes) */
export function getCurrentlyFocusedElement(limitdoc?: Document)
{
  try
  {
    var focused = getActiveElement(getToplevelWindow().document);
    while(true)
    {
      let frame = asIframe(focused);
      if(frame && (!limitdoc || frame.ownerDocument != limitdoc))
        focused = getActiveElement(frame.contentDocument);
      else
        break;
    }
    if(focused && limitdoc && focused.ownerDocument != limitdoc)
      return null;
    return focused;
  }
  catch(e)
  {
    return null;
  }
}

function getIframeFocusableNodes(currentnode: HTMLIFrameElement, recurseframes: boolean)
{
  //ADDME force body into list?
  var subnodes: Element[] = [];
  try
  {
    const body = currentnode.contentDocument?.body || currentnode.contentWindow?.document.body || null;
    if (body?.isContentEditable)
      return subnodes;

    subnodes = getFocusableComponents(body, recurseframes);
  }
  catch (e)
  {
    console.log("failed to descend into iframe",e);
  }

  return subnodes;
}

// whether the node is reachable for focus by keyboard navigation
// (because tabIndex == -1 will be seen a non(keyboard)focusable by this function)
// TODO this function should probably be cleaner but you'll be breaking a lot of tests in subtle ways if you change it. 
//      well perhaps we don't need to check for "COMMAND" but I've lost any further appetite on cleanup attempts
export function canFocusTo(node: any) //returns if a -visible- node is focusable (this function does not check for visibility itself)
{
  try
  {
    if(node.nodeType != 1)
      return false;
    if(node.contentEditable === "true")
      return true;

    // http://dev.w3.org/html5/spec-preview/editing.html#focusable
    if(node.tabIndex == -1) //explicitly disabled
      return false;

    return (parseInt(node.getAttribute('tabIndex')) >= 0) //we cannot read the property tabIndex directly, as IE <= 8 will return '0' even if the tabIndex is missing
                                                          //even then: a[name] reports tabIndex 0 but has no getAttribute('tabIndex') so be prepared if you try to fix this..
           || (["A","LINK"].includes(node.nodeName) && node.href)
           || (!node.disabled && (["BUTTON","SELECT","TEXTAREA","COMMAND"].includes(node.nodeName)
                                  || (node.nodeName=="INPUT" && node.type != "hidden")));
  }
  catch(e)
  {
    return false; //the code above may fail eg on IE11 if it's a Flash object that'ss still loading
  }
}

export function getFocusableComponents(startnode: Element | null, recurseframes: boolean)
{
  var focusable: Element[] = [];
  if (!startnode)
    return focusable;
  for(var currentnode=startnode.firstElementChild;currentnode;currentnode=currentnode.nextElementSibling) //can't use element.getChildren, startnode may be document
  {
    // Get current style (avoid mootools due to cross-frame issues)
    var currentstyle = getComputedStyle(currentnode);
    if (!currentstyle || currentstyle.display == "none" || currentstyle.visibility == "hidden")
    {
      //if(currentnode.getStyle) console.log("getFocusableComponents skipping",currentnode, $(currentnode).getStyle("display"), currentnode.getStyle("visibility"))
      continue;
    }
    
    if(recurseframes && asIframe(currentnode)) //might contain more things to focus
    {
      const subnodes = getIframeFocusableNodes(asIframe(currentnode)!, recurseframes);
      if(subnodes.length)
        focusable=focusable.concat(subnodes);
    }
    else if(canFocusTo(currentnode))
    {
      focusable.push(currentnode);
    }

    if ((currentnode as HTMLElement).isContentEditable)
      continue; //don't look for further focusable nodes inside, the whole RTE counts as an editable component

    const subnodes = getFocusableComponents(currentnode, recurseframes);
    if(subnodes.length)
      focusable = focusable.concat(subnodes);
  }
  return focusable;
}

export function getAllFocusableComponents()
{
  return getFocusableComponents(getToplevelWindow().document.documentElement, true);
}
