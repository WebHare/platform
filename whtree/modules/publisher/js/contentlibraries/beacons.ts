import * as dompack from "@webhare/dompack";
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler';
import { generateRandomId } from "@webhare/std";
import { debugFlags } from "@webhare/env/src/envbackend";

let visitCount = 0;
let beaconconsent: string | null = '';
let holdbeacons: Array<() => void> | undefined;

type BeaconStorage = Record<string, { timestamps: number[] }>;

export function isSet(tag: string, options?: {
  since?: Date | number;
  minCount?: number;
  maxCount?: number;
}) {
  const since = options?.since ? typeof options?.since === "number" ? options.since : options.since.getTime() : 0;
  const beacons = dompack.getLocal<BeaconStorage>("wh:beacons") || {};
  if (!beacons[tag])
    return false;
  if (since)
    beacons[tag].timestamps = beacons[tag].timestamps.filter(_ => _ >= since);
  return beacons[tag].timestamps.length >= (options?.minCount ?? 1) && beacons[tag].timestamps.length <= (options?.maxCount ?? Number.MAX_SAFE_INTEGER);
}

export function trigger(tag: string) {
  const instr = () => executeTrigger(tag);
  if (holdbeacons)
    holdbeacons.push(instr);
  else
    instr();
}
export function clear(tag: string | RegExp) {
  const instr = () => executeClear(tag);
  if (holdbeacons)
    holdbeacons.push(instr);
  else
    instr();
}

function runDelayedInit() {
  holdbeacons?.forEach(func => func());
  holdbeacons = undefined;
  initVisitCount();
}

function executeTrigger(tag: string) {
  if (debugFlags.bac)
    console.log("[bac] Trigger beacon", tag);

  const beacons = dompack.getLocal<BeaconStorage>("wh:beacons") || {};
  if (beacons[tag] && beacons[tag].timestamps) {
    beacons[tag].timestamps.push(Date.now());
    //Limit to 100 timestamps
    if (beacons[tag].timestamps.length > 100)
      beacons[tag].timestamps.splice(0, beacons[tag].timestamps.length - 100);
  } else
    beacons[tag] = { timestamps: [Date.now()] };
  dompack.setLocal("wh:beacons", beacons);

  if (window.dataLayer)
    window.dataLayer.push({ event: 'wh:trigger-user-beacon', whUserBeacon: tag });
}

function executeClear(tag: string | RegExp) {
  if (debugFlags.bac)
    console.log("[bac] Clearing beacons", tag);

  const beacons = dompack.getLocal<BeaconStorage>("wh:beacons") || {};
  for (const key of Object.keys(beacons)) {
    if (key === tag || (tag instanceof RegExp && key.match(tag))) {
      if (debugFlags.bac)
        console.log("[bac] Clear beacon", key);

      delete beacons[key];
      if (window.dataLayer)
        window.dataLayer.push({ event: 'wh:clear-user-beacon', whUserBeacon: key });
    }
  }
  dompack.setLocal("wh:beacons", beacons);
}

export function list() {
  const beacons = dompack.getLocal<BeaconStorage>("wh:beacons") || {};
  return Object.keys(beacons).map(tag => ({
    name: tag,
    timestamps: beacons[tag].timestamps
  }));
}

function initVisitCount() {
  if (holdbeacons)
    return; //allow onConsentChange to invoke us

  const visitor = dompack.getLocal<{ count: number }>("wh:visitor");
  let sessionId = dompack.getSession("wh:visitor");

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

  if (!visitor) {
    // First visit
    visitCount = 1;
    sessionId = generateRandomId();
    dompack.setLocal("wh:visitor", { sessionId, count: visitCount });
    dompack.setSession("wh:visitor", sessionId);

    if (debugFlags.bac)
      console.log("[bac] New visitor", sessionId, visitCount);
  } else if (!sessionId) {
    // New session for known visitor
    visitCount = visitor.count + 1;
    sessionId = generateRandomId();
    dompack.setLocal("wh:visitor", { ...visitor, count: visitCount });
    dompack.setSession("wh:visitor", sessionId);

    if (debugFlags.bac)
      console.log("[bac] New session", sessionId, visitCount);
  } else {
    // Same session (for new visitors, visitor.sessionId === sessionId and visitor.count === 1)
    visitCount = visitor.count;

    if (debugFlags.bac)
      console.log("[bac] Same session", sessionId, visitCount);
  }

  if (window.dataLayer)
    window.dataLayer.push({ event: 'wh:user-visit-count', whUserVisitCount: visitCount });
}

export function getVisitCount() {
  return visitCount;
}

export function resetVisitCount({ sessiononly = false } = {}) {
  dompack.setSession("wh:visitor", null);
  if (!sessiononly) {
    visitCount = 0;
    dompack.setLocal("wh:visitor", null);
  }

  if (debugFlags.bac)
    console.log("[bac] Visit count reset", { sessiononly }, visitCount);
}


let autoTriggerTimeout: NodeJS.Timeout | null = null;

function autoTriggerBeacons() {
  if (autoTriggerTimeout)
    clearTimeout(autoTriggerTimeout);
  autoTriggerTimeout = null;
  dompack.dispatchCustomEvent(window, "wh:triggerbeacon", { cancelable: false, bubbles: true });
}

export function triggerWidgetBeacons() {
  // Don't directly trigger the beacon yet, as the dataLayer may not have been initialized and this way we can collapse
  // multiple calls. Also allows us to wrap beacons behind consent checks
  if (!autoTriggerTimeout)
    autoTriggerTimeout = setTimeout(autoTriggerBeacons, 10);
}

class TriggerBeacon {
  node;

  constructor(node: HTMLElement) {
    this.node = node;
    // Define a handler for the trigger event, and save to remove it later
    window.addEventListener("wh:triggerbeacon", this.triggerHandler);
    // Check if this beacon is part of a form page, so we can trigger the beacon if the page becomes visible
    const pageNode = this.node.closest(".wh-form__page");
    if (pageNode) {
      if (debugFlags.bac)
        console.log("[bac] Form page beacon", this.node.dataset.beacon);
      pageNode.addEventListener("wh:form-pagechange", this.triggerHandler);
    }
    triggerWidgetBeacons();
  }

  triggerHandler = () => {
    if (this.isVisible()) {
      if (this.node.dataset.beacon)
        trigger(this.node.dataset.beacon);
      window.removeEventListener("wh:triggerbeacon", this.triggerHandler);
    } else if (debugFlags.bac)
      console.log("[bac] Not triggering invisible beacon", this.node.dataset.beacon);
  };

  isVisible() {
    let node: Element = this.node;
    while (node && node !== document.body) {
      if (getComputedStyle(node).display === "none")
        return false;
      node = node.parentNode as Element;
    }
    return true;
  }
}

export function __setup(consent: string | null) {
  beaconconsent = consent;
  if (beaconconsent) {
    holdbeacons = [];
    consenthandler.onConsentChange(consentsettings => {
      if (!holdbeacons)
        return; //already flushed any beacons

      if (beaconconsent === "*") {
        if (consentsettings.consent?.length) {
          if (debugFlags.bac)
            console.log(`[bac] Got any consent, allow beacons`);
          runDelayedInit();
        }
      } else if (beaconconsent && consentsettings.consent?.includes(beaconconsent)) {
        if (debugFlags.bac)
          console.log(`[bac] Got consent '${beaconconsent}', allow beacons`);
        runDelayedInit();
      } else {
        if (debugFlags.bac)
          console.log("[bac] No consent yet to allow beacons");
      }
    });
  }

  initVisitCount();
  dompack.register("wh-beacon", node => {
    if (node.dataset.beacon)
      new TriggerBeacon(node);
  });
}
