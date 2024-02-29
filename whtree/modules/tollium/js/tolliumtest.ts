/* tolliumtest is a 'clean start' to not have to restucture and refactor the original
   tollium test APIs

   (eg: compByName is going to require a lot of downstream changes if it would document it could
        return null (lots of !s) or start throwing if a component was not found */

import { toElement } from "dompack/testframework/pointer";
import { getCurrentScreen, getTestScreen } from "./testframework";

import * as test from "@webhare/test-frontend";
import { qSA } from "@webhare/dompack";

const proxies = new WeakMap<HTMLElement, ComponentProxy>();

class ComponentProxy {
  readonly node: HTMLElement;

  constructor(node: HTMLElement) {
    this.node = node;
  }

  [toElement]() {
    return this.node;
  }

  click() {
    this.node.click();
  }

  ////////////////////////////
  // "Legacy" APIs to allow faster code conversion
  get textContent(): string {
    return this.node.textContent || '';
  }

  querySelector<K extends keyof HTMLElementTagNameMap>(selectors: K): HTMLElementTagNameMap[K] | null;
  querySelector<T extends Element = Element>(selector: string): T | null;

  querySelector<T extends Element = Element>(selector: string) {
    return this.node.querySelector<T>(selector);
  }

  querySelectorAll<K extends keyof HTMLElementTagNameMap>(selectors: K): NodeListOf<HTMLElementTagNameMap[K]>;
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>;

  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E> {
    return this.node.querySelectorAll<E>(selectors);
  }
}

export async function launchScreen(resource: string) {
  if (!resource.match(/^([^/]*)::.+/))
    throw new Error(`launchScreen requires an absolute resource, got ${resource}`);

  await test.load(getTestScreen(resource));
  await test.waitForUI();
  //FIXME verify a screen opened
}

function matchesLabel(el: HTMLElement, textlabel: string) {
  if (el.textContent === textlabel)
    return true;

  if (qSA(el, '[aria-label]').
    //make sure we're still in the samen tollium component
    filter(subel => subel.closest('[data-name]') === el).
    //match by aria-label
    some(subel => subel.ariaLabel === textlabel)) {
    return true;
  }

  return false;
}

export function comp(name: string, options?: { allowMissing: false }): ComponentProxy;
export function comp(name: string, options?: { allowMissing: boolean }): ComponentProxy | null;

export function comp(name: string, options?: { allowMissing: boolean }): ComponentProxy | null {
  const screen = getCurrentScreen();
  const candidates = (screen.qSA('*[data-name]')! as HTMLElement[]).filter(
    el => el.dataset.name == `${screen.win.screenname}:${name}`
      || (name.startsWith(':') && matchesLabel(el, name.substring(1))));

  if (candidates.length > 1) {
    console.error(`Multiple matches for name '${name}'`, candidates);
    throw new Error(`Multiple matches for name '${name}'`);
  }

  if (candidates.length == 0) {
    if (!options?.allowMissing)
      throw new Error(`Component '${name}' not found in screen '${screen.win.screenname}'`);
    return null;
  }

  /* FIXME
    //look for pulldowns, they have an odd name
    const pulldown = this.qS(`select[data - name*= ':${toddname}$']`);
    if (pulldown)
      return pulldown;
    */

  //TODO emplace for weakmaps
  if (!proxies.has(candidates[0]))
    proxies.set(candidates[0], new ComponentProxy(candidates[0]));

  return proxies.get(candidates[0])!;
}
