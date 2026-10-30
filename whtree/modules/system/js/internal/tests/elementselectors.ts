import * as dompack from "@webhare/dompack";
import type { TestQueriedElement } from '@mod-system/js/wh/testframework';
import { getDoc } from '@webhare/test-frontend/src/suite-support';

export type SelectorPart = string | Element | RegExp | number | (() => string | Element | RegExp | number | undefined | null);
export type Selector = SelectorPart[] | string;

function evaluateSelectSingle(start: Element | Document, selector: Selector, options?: { expectSVG?: boolean }): SVGElement | HTMLElement | null {
  let currentmatch: Document | Element | Element[] = start;
  if (typeof selector === "string")
    selector = [selector];

  for (let step of selector) {
    if (typeof step === "function") {
      const result = step();
      if (result === null || result === undefined)
        return null;
      step = result;
    }

    if (typeof step === "string") {
      if (Array.isArray(currentmatch)) {
        //Special case - if currentmatch[0] is an iframe we will query into it (to allow ["#site2", ".whlive-chat__input"] paths)
        if (currentmatch.length === 1 && currentmatch[0].matches("iframe")) {
          const doc: Document | null = (currentmatch[0] as HTMLIFrameElement).contentDocument; //enter the iframe document
          if (!doc)
            return null; //not available yet  TODO: also do a cross-origin test and return null if the iframe is inacessible

          currentmatch = doc;
        } else {
          console.log(typeof step, step, currentmatch);
          throw new Error("Invalid testfw-selector, require index after selector");
        }
      }

      currentmatch = dompack.qSA(currentmatch, step);
      if (!currentmatch.length)
        return null; //not yet resolvable
    } else if (typeof step === "object" && step instanceof RegExp) {
      if (Array.isArray(currentmatch)) { //we could redefine this as a 'is filter'
        currentmatch = currentmatch.filter(_ => _.textContent.match(step));
        if (!currentmatch.length)
          return null; //not yet resolvable
      } else {
        if (!currentmatch.textContent?.match(step))
          return null; //not yet matching
      }
    } else if (typeof step === 'object' && "ownerDocument" in step) {
      if (!(Array.isArray(currentmatch) ? currentmatch : [currentmatch]).some(e => e.contains(step)))
        return null; //not yet matching
      currentmatch = step;
    } else if (typeof step === "number") {
      if (!Array.isArray(currentmatch))
        throw new Error("Invalid testfw-selector, require selector before index");
      if (step >= currentmatch.length)
        return null; //not yet resolvable

      currentmatch = currentmatch[step];
    } else {
      console.log(typeof step, step);
      throw new Error("Invalid testfw-selector, require selector before index");
    }
  }

  if (Array.isArray(currentmatch)) {
    if (currentmatch.length > 1) {
      console.error(`Multiple matches for selector %o: %o`, selector, currentmatch);
      throw new Error("Multiple matches for selector " + selector.slice(-1)[0]);
    }
    currentmatch = currentmatch[0];
  }
  if (!currentmatch)
    return null;

  if (options?.expectSVG) {
    if (!dompack.isSVGElement(currentmatch)) {
      console.error(`Matched a non-SVGElement: %o`, currentmatch);
      throw new Error("Matched a non-SVGElement");
    }
  } else { //Our API is much more convenient to typed users if we always return a HTMLElement, so enforce that
    if (!dompack.isHTMLElement(currentmatch)) {
      console.error(`Matched a non-HTMLElement: %o`, currentmatch);
      throw new Error("Matched a non-HTMLElement");
    }
  }

  return currentmatch as HTMLElement;
}

/** Lookup an element in the DOM using our testfw selectors
 * @param selector - either a direct string or an array of [selector,index,selector,index,...]
 * @returns The requested element or null if not found
*/
export function findElement<E extends SVGElement>(selector: Selector, options: { expectSVG: true }): E | null;
export function findElement<E extends Element = TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): E | null;

export function findElement<E extends Element = TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): E | null {
  return evaluateSelectSingle(getDoc(), selector, options) as E | null;
}

//Set up overloads for both call approaches (with and without starting element)
export function qSA<E extends HTMLElement = TestQueriedElement>(startnode: ParentNode, selector: string): E[];
export function qSA<E extends HTMLElement = TestQueriedElement>(selector: string): E[];

/** Find elements in the test window
    @param node_or_selector - Starting node (optional)
    @param selector - CSS selector to use
    @returns An array of matching elements */
export function qSA<E extends HTMLElement = TestQueriedElement>(node_or_selector: ParentNode | string, selector?: string): E[] {
  if (typeof node_or_selector !== 'string')
    return Array.from(node_or_selector.querySelectorAll(selector as string));

  const iframe = window.parent.document.querySelector<HTMLIFrameElement>('#testframeholder iframe')!;
  return Array.from(iframe.contentDocument!.querySelectorAll(node_or_selector));
}
