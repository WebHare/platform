import * as dompack from "@webhare/dompack";
import "./tolliumtools.scss";
import type * as debuginterface from "@mod-tollium/js/internal/debuginterface";
import { addToMagicMenu } from "./magicmenu";
import { setupDebugKeyboard } from "./debug-keyboard";

declare global {
  interface Window {
    //initialized by debugLoader so we should be able to assume its present
    __loadedDevTools: Set<string>;
  }
}

interface ToddNode extends HTMLElement {
  propTodd?: debuginterface.ToddCompBase;
}

function buildToddInfo(node: HTMLElement, todd: debuginterface.ToddCompBase): HTMLDivElement {
  return <div>
    {todd.name} {(todd as unknown as { action: string }).action ? " action: " + (todd as unknown as { action: string }).action : ""}
  </div>;
}

function checkMouseOver(evt: MouseEvent) {
  const stack = dompack.qS("tollium-stack");
  const tolliumnodes: HTMLDivElement[] = [];

  for (let node = evt.target as HTMLElement | null; node; node = node!.parentNode as HTMLElement | null) {
    if ((node as ToddNode).propTodd) {
      const todd = (node as ToddNode).propTodd!;
      tolliumnodes.unshift(buildToddInfo(node, todd));
    }
  }

  stack?.replaceChildren(...tolliumnodes);
}

function setupTolliumTools() {
  const tools = <tollium-tools><tollium-stack></tollium-stack></tollium-tools>;
  document.body.append(tools);

  window.__loadedDevTools.add("devkit:tolliumtools");

  //TODO register events only if activated
  addEventListener("mouseover", checkMouseOver);

  window.$tolliumhooks = {
    onMagicMenu: addToMagicMenu
  };
}

setupDebugKeyboard();
setupTolliumTools();
