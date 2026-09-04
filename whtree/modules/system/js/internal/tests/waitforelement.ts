import * as dompack from "@webhare/dompack";
import * as test from '@mod-system/js/wh/testframework';

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
    if (!("ownerSVGElement" in currentmatch)) {
      console.error(`Matched a non-SVGElement: %o`, currentmatch);
      throw new Error("Matched a non-SVGElement");
    }
  } else { //Our API is much more convenient to typed users if we always return a HTMLElement, so enforce that
    if (!("accessKey" in currentmatch) || !("writingSuggestions" in currentmatch)) {
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
export function findElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): E | null;

export function findElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): E | null {
  return evaluateSelectSingle(test.getDoc(), selector, options) as E | null;
}

/** Wait for an element in the DOM to appear and become clickable. Scroll into view where needed
 * @param selector - either a direct string or an array of [selector,index,selector,index,...]
 * @returns The requested element (will throw on timeout)
*/
export async function waitForElement<E extends SVGElement>(selector: Selector, options: { expectSVG: true }): Promise<E>;
export async function waitForElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): Promise<E>;

export async function waitForElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): Promise<E> {
  let logstate = Date.now() + 5000;
  return await test.wait(() => {
    const lognow = Date.now() > logstate;
    if (lognow)
      logstate = Date.now() + 5000; //wait 5sec again for new reports

    const node = findElement<E>(selector, options);
    if (!node) {
      if (lognow)
        console.warn("waitForElement: no match for selector", selector);
      return null;
    }

    if (test.canClick(node)) {
      return node;
    }

    const bcr = node.getBoundingClientRect();
    if (lognow)
      console.warn(`waitForElement: node at ${JSON.stringify(bcr)} not clickable`, node, selector);

    if (bcr.width > 0 && bcr.height > 0) { //it's there but apparently not visible}
      node.scrollIntoView({ block: "center", inline: "center" }); //FIXME don't run unless bcr ACTUALLY changed
    }

    return null;
  });
}
