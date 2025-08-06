import { isMultiSelectKey } from "@webhare/dompack";
import type { IndyShell } from "../shell";

function globalKeyHander(ev: KeyboardEvent, shell: IndyShell) {
  // Prevent cmd|control arrows from navigating the brwoser
  if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && isMultiSelectKey(ev)) {
    // Note that all major browsers don't bind Backspace to 'back' nowadays so we're no longer bothering to intercept it (as we also need to figure out if a focused control would still respond)
    ev.preventDefault();
    return;
  }

  if (ev.ctrlKey && ev.shiftKey) { //tollium global shortcuts
    // Allow keyboard events to select applications by their 'bar' positions (TODO shouldn't the shell be 'owning' application order ?)
    if (ev.code.startsWith("Digit")) {
      // Note that we map the usual physical keyboard to the tabs... so 1 is always dashboard and 0 is app #10
      const appPos = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].indexOf(ev.code[5]);
      if (appPos >= 0) {
        shell.applicationbar?._gotoApp('absolute', appPos);
        ev.preventDefault();
        return;
      }
    }

    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      // Ctrl+Shift+ArrowLeft/Right to navigate between applications
      shell.applicationbar?._gotoApp('relative', ev.key === "ArrowLeft" ? -1 : +1);
      ev.preventDefault();
      return;
    }
  }
}

export async function setupKeyboardHandling(shell: IndyShell) {
  document.body.addEventListener("keydown", evt => globalKeyHander(evt, shell));
}
