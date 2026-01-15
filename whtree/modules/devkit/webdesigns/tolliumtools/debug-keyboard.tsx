import { getCurrentlyFocusedElement } from "@mod-system/js/dompack/browserfix/focus";
import * as dompack from "@webhare/dompack";
import "@mod-tollium/js/internal/debuginterface";

class DebugKeyboard {
  keyboardnode: HTMLElement;
  aborter = new AbortController;

  constructor() {
    this.keyboardnode = <div style={{ position: "fixed", top: "0", left: "0", padding: "5px", backgroundColor: "#000000aa", color: "#ffffff" }}>
      Debug: log<b><u>F</u></b>ocus <b><u>R</u></b>estartApp
    </div>;
    document.body.append(this.keyboardnode);
    addEventListener("keydown", e => console.log(e), { capture: true, signal: this.aborter.signal });
    addEventListener("keypress", this.onKey, { capture: true, signal: this.aborter.signal });
  }

  onKey = (evt: KeyboardEvent) => {
    dompack.stop(evt);

    if (isDebugKey(evt)) {
      this.close();
      return;
    }

    const key = evt.key.toLowerCase();
    if (key === "f") {
      console.log("Currently focused:", getCurrentlyFocusedElement());
      return;
    }
    if (key === "r") {
      window.$tollium?.getActiveApplication()?.restartApp();
      this.close();
      return;
    }

    console.log(evt);
  };

  close() {
    this.keyboardnode.remove();
    this.aborter.abort();
    debugkeyboard = undefined;
  }
}

let debugkeyboard: DebugKeyboard | undefined;

function isDebugKey(evt: KeyboardEvent) {
  return evt.key === "/" && evt.shiftKey && evt.ctrlKey;
}

export function setupDebugKeyboard() {
  addEventListener("keypress", evt => {
    if (isDebugKey(evt) && !debugkeyboard) {
      debugkeyboard = new DebugKeyboard();
      dompack.stop(evt);
    }
  }, { capture: true });
}
