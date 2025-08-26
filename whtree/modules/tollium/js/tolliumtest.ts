/* tolliumtest is a 'clean start' to not have to restucture and refactor the original
   tollium test APIs

   (eg: compByName is going to require a lot of downstream changes if it would document it could
        return null (lots of !s) or start throwing if a component was not found */

import { toElement, type CastableToElement } from "dompack/testframework/pointer";
import { getCurrentScreen, getTestScreen } from "./testframework";

import * as test from "@webhare/test-frontend";
import { changeValue, isFormControl, qSA } from "@webhare/dompack";
import { nameToSnakeCase } from "@webhare/std";

const proxies = new WeakMap<HTMLElement, ComponentProxy>();

class ListProxy {
  constructor(private comp: ComponentProxy) {
  }

  /** Find a visible list row containing the specified text */
  getRow(searchFor: RegExp): HTMLElement {
    const rows = qSA(this.comp.node, '.listrow').filter(node => node.textContent?.match(searchFor));
    if (rows.length > 1)
      throw new Error(`Multiple rows in ${this.comp.getCompName()} contain '${searchFor}'`);
    if (rows.length === 0)
      throw new Error(`No rows in ${this.comp.getCompName()} contain '${searchFor}'`);

    return rows[0];
  }

  /** Find a list header cell containing the specified text */
  getHeader(searchFor: RegExp): HTMLElement {
    const headers = qSA(this.comp.node, '.listheader > span').filter(node => node.textContent?.match(searchFor));
    if (headers.length > 1)
      throw new Error(`Multiple headers in ${this.comp.getCompName()} contain '${searchFor}'`);
    if (headers.length === 0)
      throw new Error(`No headers in ${this.comp.getCompName()} contain '${searchFor}'`);

    return headers[0];
  }
}

class ComponentProxy implements CastableToElement {
  readonly node: HTMLElement;

  constructor(node: HTMLElement) {
    this.node = node;
  }

  [toElement](): HTMLElement {
    return this.node;
  }

  get list() {
    if (!this.node.classList.contains("wh-list"))
      throw new Error(`Component ${this.getCompName()} is not a list`);
    return new ListProxy(this);
  }

  click() {
    this.node.click();
  }

  getCompName(): string {
    return this.node.dataset.name ? `'${this.node.dataset.name}'` : `<unnamed ${this.node.tagName.toLowerCase()}>`;
  }

  /** Obtain the text value for components that don't differentiate between their normal and text value */
  private getIfTextValue(): string | undefined {
    if (this.node.matches("t-textarea"))
      return this.node.querySelector("textarea")!.value;
    if (this.node.matches("t-textedit")) //But what if valuetype= is set?  currently not passed to tollium frontend anyway
      return this.node.querySelector('input')!.value;
  }

  /** Obtain the 'natural' value for this component's form control */
  getValue(): string | boolean | number {
    const textvalue = this.getIfTextValue();
    if (textvalue !== undefined)
      return textvalue;

    if (this.node.matches("input[type=checkbox], input[type=radio]"))
      return Boolean((this.node as HTMLInputElement).checked);
    if (this.node.matches("select"))
      return (this.node as HTMLSelectElement).value;

    throw new Error(`Don't know how to getValue yet for node '${this.node.dataset.name}'`);
  }

  /** Obtain the text value for this component's form control */
  getTextValue() {
    const textvalue = this.getIfTextValue();
    if (textvalue !== undefined)
      return textvalue;

    if (this.node.matches("select"))
      return (this.node as HTMLSelectElement).selectedOptions[0].textContent || '';

    const input = this.node.querySelector("input");
    if (input)
      return input.value;

    throw new Error(`Don't know how to getTextValue yet for node '${this.node.dataset.name}'`);
  }

  /** Set a value, allowing events to trigger */
  set(value: unknown) {
    if (isFormControl(this.node)) {
      if (this.node.matches("input[type=checkbox]")) {
        if (typeof value !== "boolean")
          throw new Error(`Checkbox input '${this.getCompName()}' expects a boolean value`);

        if ((this.node as HTMLInputElement).checked !== value) {
          this.node.focus();
          changeValue(this.node, value);
        } else {
          console.warn("Checkbox", this.node, "already has the value", value);
        }
        return;
      }

      if (this.node.matches("select")) {
        if (typeof value !== "string")
          throw new Error(`Pulldown '${this.getCompName()}' expects a string value`);

        const targets = value.startsWith(':') ? [...(this.node as HTMLSelectElement).options].filter(opt => opt.textContent === value.substring(1)) :
          [...(this.node as HTMLSelectElement).options].filter(opt => opt.value === value);

        if (targets.length > 1)
          throw new Error(`Multiple options in pulldown '${this.getCompName()}' match '${value}'`);
        if (targets.length === 0)
          throw new Error(`No options in pulldown '${this.getCompName()}' match '${value}'`);

        if ((this.node as HTMLSelectElement).value !== targets[0].value) {
          this.node.focus();
          changeValue(this.node, targets[0].value);
        } else {
          console.warn("Puldown", this.node, "already has the value", targets[0].value);
        }
        return;
      }
    }
    throw new Error(`Don't know how to set() for node '${this.getCompName()}'`);
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
  if (el.ariaLabel === textlabel)
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
  const snakeName = nameToSnakeCase(name);
  const candidates = (screen.qSA('*[data-name]')! as HTMLElement[]).filter(
    el => el.dataset.name === `${screen.win.screenname}:${snakeName}` //direct name match
      || (el.tagName === 'SELECT' && el.dataset.name?.startsWith(`${screen.win.screenname}:${snakeName}$`)) //<select type="pulldown" is sent as a subelement named pulldown$<seqnr>
      || (name.startsWith(':') && matchesLabel(el, name.substring(1))));

  if (candidates.length > 1) {
    console.error(`Multiple matches for name '${name}'`, candidates);
    throw new Error(`Multiple matches for name '${name}'`);
  }

  if (candidates.length === 0) {
    if (!options?.allowMissing)
      throw new Error(`Component '${name}' not found in screen '${screen.win.screenname}'`);
    return null;
  }

  //TODO emplace for weakmaps
  if (!proxies.has(candidates[0]))
    proxies.set(candidates[0], new ComponentProxy(candidates[0]));

  return proxies.get(candidates[0])!;
}
