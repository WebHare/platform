import * as dompack from "@webhare/dompack";
import * as test from '@mod-system/js/wh/testframework';

export type SelectorPart = string | Element | RegExp | number;
export type Selector = SelectorPart[];

function evaluateSelectSingle(start: Element | Document, selector: Selector): Element | null {
  let currentmatch: Document | Element | Element[] = start;
  if (typeof selector == "string")
    selector = [selector];

  if (typeof selector[0] == 'object' && (selector[0] as Element).ownerDocument) {
    currentmatch = selector[0] as Element;
    selector = selector.slice(1); //don't edit the original selector list ... repeated waits always need the full list
  }

  for (const step of selector) {
    if (typeof step == "string") {
      if (Array.isArray(currentmatch)) {
        //Special case - if currentmatch[0] is an iframe we will query into it (to allow ["#site2", ".whlive-chat__input"] paths)
        if (currentmatch.length == 1 && currentmatch[0].matches("iframe")) {
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
    } else if (typeof step == "object" && step instanceof RegExp) {
      if (Array.isArray(currentmatch)) { //we could redefine this as a 'is filter'
        currentmatch = currentmatch.filter(_ => _.textContent.match(step));
        if (!currentmatch.length)
          return null; //not yet resolvable
      } else {
        if (!currentmatch.textContent?.match(step))
          return null; //not yet matching
      }
    } else if (typeof step == "number") {
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
    return currentmatch[0];
  }

  if (currentmatch && !(currentmatch as HTMLElement).ownerDocument) {
    console.error(`Matched a non-element: %o`, currentmatch); //TODO or outside the DOM ?
    throw new Error("Matched a non-element");
  }
  return currentmatch as Element;
}

//wairForElement: wait for the selector to appear in the DOM and be clickable
//selector: either a direct string or an array of [selector,index,selector,index,...]
export async function waitForElement(selector: Selector) {
  let logstate = Date.now() + 5000;
  return await test.wait(() => {
    const lognow = Date.now() > logstate;
    if (lognow)
      logstate = Date.now() + 5000; //wait 5sec again for new reports

    const node = evaluateSelectSingle(test.getDoc(), selector);
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
