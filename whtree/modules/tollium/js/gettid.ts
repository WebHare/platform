
import {
  getTid as getTidFromJSSDK,
  getTidLanguage,
  setTidLanguage,
  getHTMLTid,
} from "@webhare/gettid";
import { registerTexts } from "@webhare/gettid/src/internal";

// Fill nodes with a data-texttid attribute with the translated text
function convertElementTids(scope = document.body) {
  // Only available in a DOM context and if the DOM is ready
  if (typeof document === "undefined" || !scope)
    return;
  Array.from(scope.querySelectorAll("*[data-texttid]")).forEach(function (node) {
    node.textContent = getTid(node.getAttribute("data-texttid") || "");
  });
}

// If this script is run within a DOM context, convert data-texttid attributes automatically
if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", () => convertElementTids());

const getTid = ((...args: Parameters<typeof getTidFromJSSDK>): string => getTidFromJSSDK(...args)) as typeof getTidFromJSSDK & {
  tidLanguage: string;
  html: typeof getHTMLTid;
};

// Define 'tidLanguage' as a property on the main export (so you can use getTid.tidLanguage)
Object.defineProperty(getTid, "tidLanguage", { get: getTidLanguage, set: setTidLanguage });
// Define 'html' as a method on the main export (so you can use getTid.html)
getTid.html = getHTMLTid;

// Export getTid as the default function, explicitly export getTid, getHTMLTid and registerTexts as well
export {
  getTid as default,
  getTid,
  getTidLanguage,
  setTidLanguage,
  getHTMLTid,
  convertElementTids,
  registerTexts
};
