/** @import: import * as domfocus from 'dompack/browserfix/focus';
*/

export function getActiveElement(doc)
{
  try
  {
    //activeElement can reportedly throw on IE9 and _definately_ on IE11
    return doc.activeElement;
  }
  catch(e)
  {
    return null;
  }
}

export function getToplevelWindow()
{
  let toplevelwindow = window;
  while(toplevelwindow.frameElement)
    toplevelwindow = toplevelwindow.parent;
  return toplevelwindow;
}
/** Find the currently focused element
    @param limitwin If set, only return compontents in the specified document (prevents editable iframes from returning subframes) */
export function getCurrentlyFocusedElement(limitdoc)
{
  try
  {
    var focused = getActiveElement(getToplevelWindow().document);
    while(true)
    {
      if (focused.tagName == "IFRAME" && (!limitdoc || focused.ownerDocument != limitdoc))
        focused = getActiveElement(focused.contentDocument);
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

function isHTMLElement(node)
{
  return node.nodeType == 1 && typeof node.className == "string";
}

function getIframeFocusableNodes(body, currentnode, recurseframes)
{
  //ADDME force body into list?
  var subnodes = [];
  try
  {
    const body = (currentnode.contentDocument || currentnode.contentWindow.document).body;
    if (body.isContentEditable)
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
export function canFocusTo(node) //returns if a -visible- node is focusable (this function does not check for visibility itself)
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
           || (["A","LINK"].includes(node.nodeName) && node.href)
           || (!node.disabled && (["BUTTON","SELECT","TEXTAREA","COMMAND"].includes(node.nodeName)
                                  || (node.nodeName=="INPUT" && node.type != "hidden")));
  }
  catch(e)
  {
    return false; //the code above may fail eg on IE11 if it's a Flash object that'ss still loading
  }
}


export function getFocusableComponents(startnode, recurseframes)
{
  var focusable=[];
  for(var currentnode=startnode.firstChild;currentnode;currentnode=currentnode.nextSibling) //can't use element.getChildren, startnode may be document
  {
    if(!isHTMLElement(currentnode))
    {
      //if(currentnode.getStyle) console.log("getFocusableComponents skipping",currentnode, $(currentnode).getStyle("display"), currentnode.getStyle("visibility"))
      continue;
    }

    // Get current style (avoid mootools due to cross-frame issues)
    var currentstyle = getComputedStyle(currentnode);
    if (!currentstyle || currentstyle.display == "none" || currentstyle.visibility == "hidden")
    {
      //if(currentnode.getStyle) console.log("getFocusableComponents skipping",currentnode, $(currentnode).getStyle("display"), currentnode.getStyle("visibility"))
      continue;
    }

    if(recurseframes && currentnode.nodeName == "IFRAME") //might contain more things to focus
    {
      const subnodes = getIframeFocusableNodes(currentnode, currentnode, recurseframes);
      if(subnodes.length)
        focusable=focusable.concat(subnodes);
    }
    else if(canFocusTo(currentnode))
    {
      focusable.push(currentnode);
    }

    if (currentnode.isContentEditable)
      continue;

    const subnodes = getFocusableComponents(currentnode, recurseframes);
    if(subnodes.length)
      focusable = focusable.concat(subnodes);
  }
  return focusable;
}

export function getAllFocusableComponents()
{
  return getFocusableComponents(getToplevelWindow().document, true);
}
