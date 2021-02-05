/* sets up global handlers for mouse related events
*/

import * as domfocus from 'dompack/browserfix/focus';
import $todd from "@mod-tollium/web/ui/js/support";

function onClick(event)
{
  if (event.defaultPrevented)
    return;

  let link = event.target.closest("a");
  if(link && (!link.target || link.target == "_self")) //under NO circumstance a hyperlink may replace the current tollium session - move it to a new window
  {
    window.open(link, '_blank');
    event.preventDefault();
  }
}

function onSelectStart(event)
{
  var target = event.target.nodeType==3 ? event.target.parentNode : event.target;
  if(['INPUT','TEXTAREA'].includes(target.tagName) || (['T-TEXT'].includes(target.tagName) && target.classList.contains('selectable')) || target.closest("div.wh-rtd-editor"))
    return; //these are okay to select. MSIE needs these explicitly allowed

  $todd.DebugTypedLog('ui', "preventing selection on: ",event.target);
  event.preventDefault();
}


function getClosestValidFocusTarget(node)
{
  for(;node;node=node.parentNode)
    if(node.nodeName === 'LABEL' || domfocus.canFocusTo(node) || (node.classList && node.classList.contains('selectable')))
      return node;
  return null;
}

function onMouseDownFallback(event)
{
  let focusable = getClosestValidFocusTarget(event.target);
  //console.log("*** mousedown reached toplevel for target:", event.target);
  //console.log("focusable elment:", focusable);

  if(!focusable)
  {
    //console.warn("*** Preventing focus transfer");
    event.preventDefault(); //prevent the body from receiving focus.
  }
}

function onContextMenuCapture(event)
{
  if(event.ctrlKey && event.shiftKey)
    event.stopPropagation(); //ensure that if both ctrl&shift are pressed, noone will intercept the context menu
  else
    event.preventDefault(); //in all other cases, we prevent the browser menu
}


function onMovingUpdate(start)
{
  document.documentElement.classList.toggle("moveInProgress", start);
}


window.addEventListener("selectstart", onSelectStart);
window.addEventListener("mousedown", onMouseDownFallback);
window.addEventListener("click", event => onClick);
window.addEventListener("dompack:movestart", () => onMovingUpdate(true), true);
window.addEventListener("dompack:moveend", () => onMovingUpdate(false), true);
window.addEventListener("contextmenu", onContextMenuCapture, true);

