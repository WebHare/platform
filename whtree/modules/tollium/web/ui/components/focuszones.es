import * as dompack from 'dompack';
const domfocus = require('@mod-system/js/dom/focus');


/// Zone history, element 0 is current focused zone
let zonehistory = [];

/// Map from zone->last focused element
let lastfocusedmap = new Map;


/// Safely get active element
function getActiveElement(doc)
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

/// Returns the focuszone of a specific element, null if not in a zone.
function getElFocusZone(el)
{
  // Ignore forcusing of body
  if (!el)
    return null;

//  console.error('getElFocusZone ', el == document.body, currentfocuszone, currentfocuszone && domfocus.getFocusableComponents(currentfocuszone).length);

  // IE focuses the body when we have a currentfocuszone without focusable elements
  if (el == document.documentElement || el == document.body)
  {
    if (zonehistory[0] && !domfocus.getFocusableComponents(zonehistory[0]).length)
      return zonehistory[0];
  }

  el = el.closest(".wh-focuszone") || null;

  // Ignore focus zones declarations on html and body nodes
  if (el == document.documentElement || el == document.body)
    return null;

  return el;
}

function gotDomReady()
{
  if (dompack.debugflags.fcz)
    console.log("fz got domready, detect current focus zone");

  detectCurrentFocusZone();
}

/// Detects current focus zone, stores current active element in the zone
function detectCurrentFocusZone()
{
  const activeelement = getActiveElement(document);
  var zone = getElFocusZone(activeelement);

  if (dompack.debugflags.fcz)
    console.log("[fcz] detectCurrentFocusZone: ", zone, " (containing element ", activeelement, ")");

  if (zone)
    setActiveZone(zone);

  return { zone, activeelement };
}

/// Set a new zone as the history top. shifts the rest of the zones up the stack, unless !!pop
function setActiveZone(zone)
{
  // Clear deleted items from the history
  filterZoneHistory();

  // Zone already active?
  let currentidx = zonehistory.findIndex(item => item == zone);
  if (currentidx == 0)
    return;

  // Save the current active zone
  let current = zonehistory[0];

  // Re-focusing zone already in history, remove from list
  if(currentidx > 0)
    zonehistory.splice(currentidx,1);

  if (current)
    dompack.dispatchCustomEvent(current, "wh:focuszone-blur", { cancelable: false, bubbles: true });

  zonehistory.unshift(zone);
  dompack.dispatchCustomEvent(zonehistory[0], "wh:focuszone-focus", { cancelable: false, bubbles: true });
}

/// Removes zones that have been removed from the document
function filterZoneHistory()
{
  zonehistory = zonehistory.filter(item =>
  {
    if(item.ownerDocument && item.ownerDocument.contains(item))
      return true;
    lastfocusedmap.delete(item);
    return false;
  });
}

function onFocus(domevent)
{
  if (dompack.debugflags.fcz)
    console.log("[fcz] fz got focus event, target ", domevent.target, domevent.target.nodeName);

  let { zone, activeelement } = detectCurrentFocusZone();
  if (zone)
    lastfocusedmap.set(zone, activeelement);
}

/// Returns the current focused zone
export function getCurrentFocusZone()
{
  return detectCurrentFocusZone().zone;
}

function focusTopZoneElement()
{
  const zone = zonehistory[0];
  const tofocus = lastfocusedmap.get(zone);

  if (tofocus && getElFocusZone(tofocus) == zone) //it's still in the proper zone
  {
    if (dompack.debugflags.fcz)
      console.log("[fcz] moving to earlier zone", zone, ", should focus", tofocus);
    dompack.focus(tofocus);
    return;
  }

  // If there was no previously focused element, emit a wh:focuszone-firstfocus event. If not
  // cancelled, the first focusable element is focused
  const continueevent = dompack.dispatchCustomEvent(zone, "wh:focuszone-firstfocus", { cancelable: true, bubbles: true });
  if(!continueevent)
  {
    if(dompack.debugflags.fcz)
      console.log("[fcz] firstfocus cancelled for zone ", zone, ' activeelement=', domfocus.getCurrentlyFocusedElement());
    return; //cancelled. we'll not explicitly focus anything and assume our canceller did it (ADDME should we still kill focus or change zones if caller didn't focus the right component?)
  }

  focusFirstFocusable();
}

function focusFirstFocusable()
{
  let zone = zonehistory[0];
  var focusable = domfocus.getFocusableComponents(zone);
  if (dompack.debugflags.fcz)
    console.log('[fcz] fz focusable', focusable, Array.from(zone.querySelectorAll('*')));
  if(focusable.length)
  {
    dompack.focus(focusable[0]);
  }
  else //there's nothing to focus in this zone
  {
    if(getActiveElement(document))
    {
      if (dompack.debugflags.fcz)
        console.log('fz blurring active element', getActiveElement(document));
      getActiveElement(document).blur();
    }
    else if (dompack.debugflags.fcz)
      console.log('fz may not blur active element', getActiveElement(document));
  }
}

function isElementInZone(zone, tocheck)
{
  return zone.contains(tocheck) && tocheck.closest("body, .wh-focuszone") == zone;
}

export function focusZone(newzone)
{
  if(dompack.debugflags.fcz)
    console.log("[fcz] focusZone on ", newzone, " current ", zonehistory[0], lastfocusedmap);

  if(!newzone || !newzone.classList.contains("wh-focuszone"))
  {
    console.error("No such focuszone",newzone);
    throw new Error("No such focuszone");
  }

  if(getCurrentFocusZone() == newzone)
  {
    //Is the real focus also in the zone?
    let focused = getActiveElement(document);
    if(dompack.debugflags.fcz)
      console.log("[fcz] that is the current zone, currently focused",focused);
    if(focused && isElementInZone(newzone, focused))
      return;

    focusFirstFocusable(newzone);
  }
  else
  {
    setActiveZone(newzone);
    focusTopZoneElement();
  }
}

/** Get the currently active element within a zone
*/
export function getFocusZoneActiveElement(zone)
{
  detectCurrentFocusZone();

  if(!zone || !zone.classList.contains("wh-focuszone"))
  {
    console.error("No such focuszone", zone);
    throw new Error("No such focuszone");
  }

  let focus = getActiveElement(zone.ownerDocument);
  if(focus && zone.contains(focus))
  { //the live element is in the requested zone. return it immediately
    if(dompack.debugflags.fcz && lastfocusedmap.get(zone) != focus)
      console.error("[fcz] Mismatch between real focus ",focus," and last focus ",lastfocusedmap.get(zone)," for zone ", zone);

    return focus;
  }

  if(dompack.debugflags.fcz)
    console.log("[fcz] Requesting focus for " + (zonehistory[0] == zone ? "active" : "historic") + " zone ", zone, " returning ", lastfocusedmap.get(zone));
  return lastfocusedmap.get(zone);
}

export function focusElement(node)
{
  if(!node.focus)
  {
    console.log("Does not look like a focusable element", node);
    throw new Error("Does not look like a focusable element");
  }

  var newzone = getElFocusZone(node);
  if(dompack.debugflags.fcz)
    console.log("[fcz] focus on ", node, " in zone ", newzone);

  setActiveZone(newzone);
  dompack.focus(node);
  //note: we don't receive focus events when we're not focused, so we need to track it ourselves

  lastfocusedmap.set(newzone, node);
}

window.addEventListener("dompack:takefocus", event =>
{
  // called at the start of dom.focus. Prevent the default action to stop dom.focus from executing the focus change.
  const target = event.target;
  if (!target.focus)
  {
    console.log("Does not look like a focusable element", target);
    throw new Error("Does not look like a focusable element");
  }

  // Get zone for the element, and locate it in the history
  let newzone = getElFocusZone(target);
  if (!newzone) // no zone? just ignore
    return;

  let currentidx = zonehistory.findIndex(item => item === newzone);
  if (currentidx === 0)
  {
    // In current zone, allow the event
    if(dompack.debugflags.fcz)
      console.log("[fcz] dom.focus on ", target, " in current zone ", newzone);
    return;
  }

  lastfocusedmap.set(newzone, target);
  event.preventDefault();

  if (currentidx === -1)
  {
    if(dompack.debugflags.fcz)
      console.log("[fcz] dom.focus on ", target, " in new zone ", newzone);

    // Place the zone back into the history as the last
    //currentidx.push(newzone);
  }
  else
  {
    if(dompack.debugflags.fcz)
      console.log("[fcz] dom.focus on ", target, " in historic zone #" + currentidx, newzone);
  }
});

window.addEventListener('focus', onFocus, true);
dompack.onDomReady(gotDomReady);
