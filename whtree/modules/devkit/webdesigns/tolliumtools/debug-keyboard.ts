import { getCurrentlyFocusedElement } from "@mod-system/js/dompack/browserfix/focus";
import { stop } from "@webhare/dompack";
import "@mod-tollium/js/internal/debuginterface";
import { html } from "@webhare/dompack/src/html";

function showDebugKeys() {
  const dialog = html("dialog", { open: true }, [
    html("h2", {}, ["TolliumTools Debug Keys"]),
    html("ul", {}, [
      html("li", {}, [html("b", {}, ["Ctrl + Shift + Alt + F"]), ": Highlight currently focused element"]),
      html("li", {}, [html("b", {}, ["Ctrl + Shift + Alt + R"]), ": Restart the current application"]),
      html("li", {}, [html("b", {}, ["Ctrl + Shift + Alt + /"]), ": Show this dialog"])
    ])
  ]);
  document.body.appendChild(dialog);

  const removEvents = new AbortController;
  const closeDialog = () => {
    dialog.close();
    dialog.remove();
    removEvents.abort();
  };

  addEventListener("mousedown", closeDialog, { signal: removEvents.signal });
  addEventListener("keydown", closeDialog, { signal: removEvents.signal });
}

function processDebugKey(evt: KeyboardEvent) {
  if (!isDebugKey(evt))
    return;

  switch (evt.code) {
    case "KeyF": {
      const el = getCurrentlyFocusedElement();
      if (el) {
        el.classList.toggle("tolliumtools--currentfocus");
        //remove putlone border on next focus change
        addEventListener("focusout", () => { el.classList.remove("tolliumtools--currentfocus"); }, { once: true, capture: true });
      }
      console.log("Currently focused:", el);
      break;
    }

    case "KeyR":
      window.$tollium?.getActiveApplication()?.restartApp();
      break;

    case "Slash": // "?" on most keyboards
      showDebugKeys();
      return;

    default:
      console.log("Unknown debug key:", evt);
      return;
  }
  stop(evt);
}

function isDebugKey(evt: KeyboardEvent) {
  return evt.shiftKey && evt.ctrlKey && evt.altKey;
}

export function setupDebugKeyboard() {
  addEventListener("keypress", processDebugKey);
}
