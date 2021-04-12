import * as dompack from "dompack";
import * as storage from "dompack/extra/storage";
import { generateId } from "@mod-consilio/js/pxl";

let visitCount = 0;

export function isSet(tag, options)
{
  options =
      { since: null
      , minCount: 1
      , maxCount: 0
      , ...options
      };
  if (options.since && options.since.getTime)
    options.since = options.since.getTime();

  const beacons = storage.getLocal("wh:beacons") || {};
  if (!beacons[tag])
    return false;
  if (options.since)
    beacons[tag].timestamps = beacons[tag].timestamps.filter(_ => _ >= options.since);
  return (beacons[tag].timestamps.length >= options.minCount && (!options.maxCount || beacons[tag].timestamps.length <= options.maxCount));
}

export function trigger(tag, options)
{
  options =
      { when: Date.now()
      , ...options
      };
  if (options.when.getTime)
    options.when = options.when.getTime();

  if (dompack.debugflags.bac)
    console.log("[bac] Trigger beacon", tag, options);

  const beacons = storage.getLocal("wh:beacons") || {};
  if (beacons[tag] && beacons[tag].timestamps)
    beacons[tag].timestamps.push(options.when);
  else
    beacons[tag] = { timestamps: [ options.when ] };
  storage.setLocal("wh:beacons", beacons);

  if (window.dataLayer)
    window.dataLayer.push( { event: 'wh:trigger-user-beacon', whUserBeacon: tag });
}

export function clear(tag)
{
  if (dompack.debugflags.bac)
    console.log("[bac] Clearing beacons", tag);

  let beacons = storage.getLocal("wh:beacons") || {};
  for (let key of Object.keys(beacons))
  {
    if (key == tag || (tag instanceof RegExp && key.match(tag)))
    {
      if (dompack.debugflags.bac)
        console.log("[bac] Clear beacon", key);

      delete beacons[key];
      if (window.dataLayer)
        window.dataLayer.push( { event: 'wh:clear-user-beacon', whUserBeacon: tag });
    }
  }
  storage.setLocal("wh:beacons", beacons);
}

export function list()
{
  const beacons = storage.getLocal("wh:beacons") || {};
  return Object.keys(beacons).map(tag => ({ name: tag
                                          , timestamps: beacons[tag].timestamps
                                          }));
}

function initVisitCount()
{
  let visitor = storage.getLocal("wh:visitor");
  let sessionId = storage.getSession("wh:visitor");

  /*
    - If visitor is null, this is a new visitor:
      - Initialize a new sessionId
      - Store the sessionId in sessionStorage
      - Create a visitor with the sessionId and a count of 1 and store it in localStorage
    - If visitor is set and sessionId is not set, this is a new session for a returning visitor:
      - Initialize a new sessionId
      - Store the sessionId in sessionStorage
      - Increase the visitor count and store it in localStorage
    - If visitor is set and sessionId is set and equal to the visitor sessionId, this is the same session for a new visitor.
    - If visitor is set and sessionId is set and not equal to the visitor sessionId, this is the same session for a returning
      visitor.
  */

  if (!visitor)
  {
    // First visit
    visitCount = 1;
    sessionId = generateId();
    storage.setLocal("wh:visitor", { sessionId, count: visitCount });
    storage.setSession("wh:visitor", sessionId);

    if (dompack.debugflags.bac)
      console.log("[bac] New visitor", sessionId, visitCount);
  }
  else if (!sessionId)
  {
    // New session for known visitor
    visitCount = visitor.count + 1;
    sessionId = generateId();
    storage.setLocal("wh:visitor", { ...visitor, count: visitCount });
    storage.setSession("wh:visitor", sessionId);

    if (dompack.debugflags.bac)
      console.log("[bac] New session", sessionId, visitCount);
  }
  else
  {
    // Same session (for new visitors, visitor.sessionId == sessionId and visitor.count == 1)
    visitCount = visitor.count;

    if (dompack.debugflags.bac)
      console.log("[bac] Same session", sessionId, visitCount);
  }

  if (window.dataLayer)
    window.dataLayer.push( { event: 'wh:user-visit-count', whUserVisitCount: visitCount });
}

export function getVisitCount()
{
  return visitCount;
}

export function resetVisitCount(options)
{
  options = { sessiononly: false, ...options };

  storage.setSession("wh:visitor", null);
  if (!options.sessiononly)
  {
    visitCount = 0;
    storage.setLocal("wh:visitor", null);
  }

  if (dompack.debugflags.bac)
    console.log("[bac] Visit count reset", options, visitCount);
}


let autoTriggerTimeout;

function autoTriggerBeacons()
{
  clearTimeout(autoTriggerTimeout);
  autoTriggerTimeout = null;
  dompack.dispatchCustomEvent(window, "wh:triggerbeacon", { cancelable: false, bubbles: true });
}

export function triggerWidgetBeacons()
{
  // Don't directly trigger the beacon yet, as the dataLayer may not have been initialized and this way we can collapse
  // multiple calls
  if (!autoTriggerTimeout)
    autoTriggerTimeout = setTimeout(autoTriggerBeacons, 10);
}

class TriggerBeacon
{
  constructor(node)
  {
    this.node = node;
    // Define a handler for the trigger event, and save to remove it later
    this.triggerHandler = event => this.handleTrigger(event);
    window.addEventListener("wh:triggerbeacon", this.triggerHandler);
    // Check if this beacon is part of a form page, so we can trigger the beacon if the page becomes visible
    const pageNode = this.node.closest(".wh-form__page");
    if (pageNode)
    {
      if (dompack.debugflags.bac)
        console.log("[bac] Form page beacon", this.node.dataset.beacon);
      pageNode.addEventListener("wh:form-pagechange", this.triggerHandler);
    }
    triggerWidgetBeacons();
  }

  handleTrigger(event)
  {
    if (this.isVisible())
    {
      trigger(this.node.dataset.beacon);
      window.removeEventListener("wh:triggerbeacon", this.triggerHandler);
    }
    else if (dompack.debugflags.bac)
      console.log("[bac] Not triggering invisible beacon", this.node.dataset.beacon);
  }

  isVisible()
  {
    let node = this.node;
    while (node && node != document.body)
    {
      if (getComputedStyle(node).display == "none")
        return false;
      node = node.parentNode;
    }
    return true;
  }
}

initVisitCount();
dompack.register("wh-beacon", node =>
{
  if (node.dataset.beacon)
    new TriggerBeacon(node);
});
