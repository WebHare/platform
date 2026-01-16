import type { BackendApplication } from "@mod-tollium/web/ui/js/application";
import type { ToddCompBase } from "@mod-tollium/web/ui/js/componentbase";
import * as dompack from "@webhare/dompack";

export function addToMagicMenu(comp: ToddCompBase, submenu: HTMLUListElement): void {
  const addactions: HTMLLIElement[] = [];
  const isbackendapp = "queueEventNoLock" in comp.owner.hostapp;

  addactions.push(<li onClick={() => logElement(comp)}>Log {comp.name} to console</li>);
  if (isbackendapp) {
    addactions.push(<li onClick={() => editElement(comp)}>Edit element {comp.name}</li>);
    addactions.push(<li onClick={() => inspectElement(comp)}>Inspect element {comp.name}</li>);
  }

  submenu.append(<li class="divider" />, ...addactions);
}

function logElement(comp: ToddCompBase) {
  console.log("logElement %s: %o", comp.name, comp);
}

function editElement(comp: ToddCompBase) {
  const backendapp = comp.owner.hostapp as BackendApplication;

  const componentpath = [];
  for (let goingup: ToddCompBase | null = comp; goingup; goingup = goingup.parentcomp)
    componentpath.push(goingup.name);

  backendapp.queueEventNoLock("$devhook", { action: "openineditor", screen: comp.owner.node.dataset.tolliumscreen, componentpath });
}

function inspectElement(comp: ToddCompBase) {
  const backendapp = comp.owner.hostapp as BackendApplication;

  const componentpath = [];
  for (let goingup: ToddCompBase | null = comp; goingup; goingup = goingup.parentcomp)
    componentpath.push(goingup.name);

  backendapp.queueEventNoLock("$devhook", { action: "inspectElement", window: comp.owner.screenname, componentpath });
}
