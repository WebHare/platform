import { onDomReady } from "@webhare/dompack";
import "./reset.css";
export { frontendConfig } from "./init";
export { startSSOLogin, login, setupWRDAuth } from "./auth";
import { navigateTo as envNavigateTo } from "@webhare/env";
export { loadAssetPack, setupAuthorMode, type AuthorModeOptions } from "./authormode";

/** @deprecated Use navigateTo from \@webhare/env */
export const navigateTo = envNavigateTo; //only the WH5.4+ webshop used this, so it should be safe to remove

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
