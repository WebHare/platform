/* sets up global handlers for mouse related events
*/

import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import  $todd from "@mod-tollium/web/ui/js/support";
import "./mousehandling.scss";

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

function stopSelectionCapture()
{
  window.removeEventListener("mousedown", stopSelectionCapture, true);
  document.documentElement.classList.remove("mousehandling--selecting");
  dompack.qSA(".mousehandling--selectionbase").forEach(node => node.classList.remove("mousehandling--selectionbase"));
}
function captureSelection(selectbase)
{
  console.log("allow select on",selectbase);

  window.addEventListener("mousedown", stopSelectionCapture, true);
  selectbase.classList.add("mousehandling--selectionbase");
  document.documentElement.classList.add("mousehandling--selecting");
}
function onSelectStart(event)
{
  let target = event.target.nodeType == 3 ? event.target.parentNode : event.target;
  if(target.matches('input,textarea') || target.closest("div.wh-rtd-editor"))
    return; //these are okay to select. MSIE needs these explicitly allowed

  /* allow selection on:
     - textnodes (but not labels, they're a t-text too. they are supposed to be clickable)
  */
  let t_text = target.closest('t-text:not(.label)');
  if(t_text)
  {
    captureSelection(t_text);
    return; //these are okay to select. MSIE needs these explicitly allowed
  }

  $todd.DebugTypedLog('ui', "preventing selection on: ",target);
  event.preventDefault();
}
function onSelectionChange(event)
{
  let sel = window.getSelection();
  if(!sel || !sel.anchorNode) //no more selection
    stopSelectionCapture();
}

function getClosestValidFocusTarget(node)
{
  for(;node;node=node.parentNode)
    if(node.nodeName === 'LABEL' || domfocus.canFocusTo(node) || (node.matches&&node.matches('t-text:not(.label)')))
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
    // console.warn("*** Preventing focus transfer");
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

export function setupMouseHandling()
{
  document.addEventListener("selectstart", onSelectStart);
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("mousedown", onMouseDownFallback);
  window.addEventListener("click", event => onClick);
  window.addEventListener("dompack:movestart", () => onMovingUpdate(true), true);
  window.addEventListener("dompack:moveend", () => onMovingUpdate(false), true);
  window.addEventListener("contextmenu", onContextMenuCapture, true);
}
