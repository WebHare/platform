import { onDomReady } from "@webhare/dompack";
import "./reset.css";
export { frontendConfig } from "./init";
export { startSSOLogin } from "./auth";
export { navigateTo } from "./navigation";
export { setupAuthorMode, type AuthorModeOptions } from "./authormode";
export type { NavigateInstruction } from "./navigation";

function postRenderChecks() {
  const log = document.getElementById("wh-console-log");
  if (log) {
    const logtext = atob(log.textContent || "");
    console.group("[etr] Server-side debug output");
    console.log(logtext);
    console.groupEnd();
  }
}

onDomReady(postRenderChecks);
