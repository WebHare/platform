/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import { dtapStage } from "@webhare/env";
import * as $todd from '@mod-tollium/web/ui/js/support';

let magicmenuactive;
let clicks = [];

///Is the magic menu active? (Always on development but we'll still let you play the animation on Dev)
function isActive() {
  return dtapStage == 'development' || magicmenuactive;
}

function onTopbarClick(event) {
  if (magicmenuactive)
    return;

  clicks = clicks.slice(-2).concat(Date.now()); //note last three clicks
  if (clicks.length == 3 && (clicks[2] - clicks[0]) < 1000) {
    magicmenuactive = true;
    dompack.qS('.wh-backend__topbar').classList.add('wh-backend__topbar--play');
    window.setTimeout(() => dompack.qS('.wh-backend__topbar').classList.remove('wh-backend__topbar--play'), 1);
  }
}

async function editElement(component) {
  const screennode = component.closest('.t-screen');

  if (!screennode)
    return alert("Sorry, no screen found there");

  const componentpath = [];
  while (component) {
    componentpath.push(component.dataset.name);
    component = component.parentNode.closest('*[data-name]');
  }

  $todd.getActiveApplication().queueEventNoLock("$devhook", { action: "openineditor", screen: screennode.dataset.tolliumscreen, componentpath });
}

function onMagicMenu(event) {
  if (!event.shiftKey || !event.altKey || !isActive())
    return;

  dompack.stop(event);

  const component = event.target.closest('*[data-name]');
  const submenu = dompack.create("ul");

  if (component) {
    submenu.append(<li class="divider" />
      , <li onClick={() => editElement(component)}>Edit element {component.dataset.name}</li>
    );
  }
  dompack.dispatchCustomEvent(event.target, 'tollium:magicmenu', { bubbles: true, cancelable: true, detail: { submenu: submenu } });
  menu.openAt(submenu, event);
}

window.addEventListener("contextmenu", onMagicMenu, true);
dompack.register('.wh-backend__topbar', node => node.addEventListener("click", onTopbarClick));
