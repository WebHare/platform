// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/frontend" {
}

import { onDomReady } from "@webhare/dompack";
import "../styling/reset.css"; // Reset CSS - this will be dropped somewhere post WH5.6!
export { frontendConfig } from "./init";
export { startSSOLogin, login, setupWRDAuth, isLoggedIn, logout } from "./auth";
import { navigateTo as envNavigateTo } from "@webhare/env";
export { loadAssetPack, setupAuthorMode, type AuthorModeOptions } from "./authormode";
import type { DataLayerEntry } from "./gtm-types";
export type * from "./gtm-types";

/** @deprecated Use navigateTo from \@webhare/env */
export const navigateTo = envNavigateTo; //only the WH5.4+ webshop used this, so it should be safe to remove

//Stubs for GTM configuration - 5.7 may/will actually require calling these APIs
export function setupGTM(args?: unknown) {
}
export function setupFormAnalyticsForGTM(args?: unknown) {
}

/** Push to the dataLayer
 * @param vars - The variables to push
 * @param options - Options for the push
 *   timeout Time before any eventCallback is forcibly called (default 200ms)
*/
export function pushToDataLayer(vars: DataLayerEntry, options?: { timeout?: number }) {
  if (vars.eventCallback) { //we'll wrap the callback into a promise to ensure it's only invoked once
    const savecallback = vars.eventCallback;
    let newcallback: () => void;
    void (new Promise<void>(resolve => newcallback = resolve)).then(() => savecallback());
    setTimeout(() => newcallback, options?.timeout || 200);
  }

  window.dataLayer.push(vars);
}

function postRenderChecks() {
  const log = document.getElementById("wh-console-log");
  if (log) {
    const logtext = atob(log.textContent || "");
    console.group("[etr] Server-side console output");
    console.log(logtext);
    console.groupEnd();
  }
}

onDomReady(postRenderChecks);
