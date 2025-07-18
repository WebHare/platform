/* sets up global handlers for mouse related events
*/

import "./mousehandling.scss";
import { isHTMLElement } from '@webhare/dompack';
import { pick } from '@webhare/std';

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || !isHTMLElement(event.target))
    return;

  const link = event.target.closest<HTMLAnchorElement>("a[href]");
  if (link && (!link.target || link.target === "_self")) { //under NO circumstance a hyperlink may replace the current tollium session - move it to a new window
    window.open(link.href, '_blank');
    event.preventDefault();
  }
}

function onContextMenuCapture(event: MouseEvent) {
  if (event.ctrlKey && event.shiftKey)
    event.stopPropagation(); //ensure that if both ctrl&shift are pressed, noone will intercept the context menu
  else
    event.preventDefault(); //in all other cases, we prevent the browser menu
}

function onMovingUpdate(start: boolean) {
  document.documentElement.classList.toggle("mousehandling--moveinprogress", start);
}

class LongPressForContextMenuWatcher {
  pressed: TouchEvent | null = null;
  timeout: NodeJS.Timeout | null = null;

  constructor() {
    window.addEventListener("touchstart", evt => this.startPotentialLongPress(evt), true);
    window.addEventListener("touchend", () => this.stopPotentialLongPress(), true);
    window.addEventListener("touchcancel", () => this.stopPotentialLongPress(), true);
  }
  startPotentialLongPress(evt: TouchEvent) {
    if (this.timeout) { //clear existing timeout
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (!isHTMLElement(evt.target))
      return; //outside the dom

    this.pressed = evt;
    this.timeout = setTimeout(() => this.handleLongPress(), 500);
  }

  stopPotentialLongPress() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  handleLongPress() {
    this.timeout = null; //the timeout has expired if we're invoked
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      ...pick(this.pressed!.changedTouches[0], ["clientX", "clientY", "screenX", "screenY"]),
    });
    this.pressed!.target!.dispatchEvent(contextMenuEvent);
  }
}

export function setupMouseHandling() {
  addEventListener("click", event => onClick);
  addEventListener("dompack:movestart", () => onMovingUpdate(true), true);
  addEventListener("dompack:moveend", () => onMovingUpdate(false), true);
  addEventListener("contextmenu", onContextMenuCapture, true);

  new LongPressForContextMenuWatcher;
}
