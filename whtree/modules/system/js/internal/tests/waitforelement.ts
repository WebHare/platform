import type * as test from '@mod-system/js/wh/testframework';
import { wait } from '@webhare/test/src/checks';
import { canClick } from 'dompack/testframework/pointer';
import { findElement, type Selector } from './elementselectors';

export { findElement, type Selector, type SelectorPart } from './elementselectors';

/** Wait for an element in the DOM to appear and become clickable. Scroll into view where needed
 * @param selector - either a direct string or an array of [selector,index,selector,index,...]
 * @returns The requested element (will throw on timeout)
*/
export async function waitForElement<E extends SVGElement>(selector: Selector, options: { expectSVG: true }): Promise<E>;
export async function waitForElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): Promise<E>;

export async function waitForElement<E extends Element = test.TestQueriedElement>(selector: Selector, options?: { expectSVG?: boolean }): Promise<E> {
  let logstate = Date.now() + 5000;
  return await wait(() => {
    const lognow = Date.now() > logstate;
    if (lognow)
      logstate = Date.now() + 5000; //wait 5sec again for new reports

    const node = findElement<E>(selector, options);
    if (!node) {
      if (lognow)
        console.warn("waitForElement: no match for selector", selector);
      return null;
    }

    if (canClick(node)) {
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
