/* To verify tree shaking viability, try:
   whcd
   cd whtree
   echo 'import "@webhare/frontend"' | node_modules/.bin/esbuild --loader:.css=empty --tsconfig=tsconfig.json --bundle --minify
*/

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/frontend" {
}

import { onDomReady } from "@webhare/dompack";
import "../styling/reset.css"; // Reset CSS - this will be dropped somewhere post WH5.6!
export { frontendConfig, getFrontendData } from "./init";
export { startSSOLogin, login, setupWRDAuth, isLoggedIn, logout } from "./auth";
export { loadAssetPack, setupAuthorMode, type AuthorModeOptions } from "./authormode";
export { setPxlOptions, sendPxl, getPxlUserId, getPxlSessionId, setupFormAnalytics, type PxlData } from "./pxl";
export { getRemoteIPAddress } from "./analytics";
export { setupFormAnalyticsForGTM } from "./gtm";

// we shouldn't deprecate navigateTo exported from frontend. in fact it makes more sense to export it from frontend than env as it's browser-only
export { navigateTo } from "@webhare/env";

/** Registry for data we receive from the backend */
export interface FrontendDataTypes {
}

/** Registry for expected PXL formats */
export interface PxlDataTypes {
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
