import type { AuthorModeOptions } from "@mod-publisher/webdesigns/authormode/authormode";
import { getLocal } from "@webhare/dompack";
export type { AuthorModeOptions };

function activeAuthorMode() {
  const script = document.createElement("script");
  script.src = "/.ap/publisher.authormode/ap.js";

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/.ap/publisher.authormode/ap.css";
  document.querySelector("head,body")?.append(script, css);
}

/** Setup author mode extensions */
export function setupAuthorMode(options?: AuthorModeOptions) {
  if (typeof window !== "undefined" && window.top === window && getLocal<string>("wh-feedback:accesstoken")?.match(/^[^.]*\.[^.]*\.[^.]*$/)) { //in a browser
    window.whAuthorModeOptions = options;
    setTimeout(activeAuthorMode, 0); //async startup.. also allows it to throw exceptions without breaking anything
  }
}
