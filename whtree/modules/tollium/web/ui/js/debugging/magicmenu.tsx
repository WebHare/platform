import * as dompack from '@webhare/dompack';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import { dtapStage } from "@webhare/env";

let magicmenuactive = false;
const clicks = new Array<number>();

const ClicksRequired = 3;
const ClicksWithinMsecs = 1000;

///Is the magic menu active? (Always on development but we'll still let you play the animation on Dev)
function isActive() {
  return dtapStage == 'development' || magicmenuactive;
}

function onTopbarClick(event: MouseEvent) {
  if (magicmenuactive)
    return;

  clicks.splice(0, clicks.length - (ClicksRequired - 1)); //Keep last two clicks
  clicks.push(Date.now()); //and add our click
  if (clicks.length == 3 && (clicks[2] - clicks[0]) < ClicksWithinMsecs) {
    magicmenuactive = true;
    dompack.qR('.wh-backend__topbar').classList.add('wh-backend__topbar--play');
    window.setTimeout(() => dompack.qR('.wh-backend__topbar').classList.remove('wh-backend__topbar--play'), 1);
  }
}

function onMagicMenu(event: dompack.DocEvent<MouseEvent>) {
  if (!event.shiftKey || !event.altKey || !isActive()) //SHIFT+ALT should give the magic menu, if activatedd
    return;

  dompack.stop(event); //cancel the contextmenu

  const toddComp = event.target.closest<HTMLElement>('*[data-name]')?.propTodd;
  if (!toddComp)
    return;

  const submenu = dompack.create("ul");
  dompack.dispatchCustomEvent(event.target, 'tollium:magicmenu', { bubbles: true, cancelable: true, detail: { submenu: submenu } });
  window.$tolliumhooks?.onMagicMenu?.(toddComp, submenu);
  menu.openAt(submenu, event);
}

dompack.addDocEventListener(document.documentElement, "contextmenu", onMagicMenu, { capture: true });
dompack.register('.wh-backend__topbar', node => dompack.addDocEventListener(node, "click", onTopbarClick));
