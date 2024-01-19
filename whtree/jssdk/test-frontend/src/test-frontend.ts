/* @webhare/test-frontend is a superset of @webhare/test with additional browser/frontend test support

   (this felt more friendly that having to add dozens of throwing APIs "not in the frontend" to @webhare/test)
   */

import { wait as oldWait } from "@mod-system/js/wh/testframework";

//We're unsplitting test.wait() again. We shouldn't have to wind up with 10 different wait methods like old testfw did with waitForElement

/** Wait for the current UIBusyLock (flagUIBusy) to clear if any
 *
 * @throws If that the UI has never been busy since the last wait (and inside the current test step) */
export async function waitUI(): Promise<void> {
  await oldWait("ui");
}

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";

//We individually vet APIs from testframework. We should only export APIs with proper typings!
export {
  load,
  waitForElement,
  qS,
  qSA,
  qR,
} from "@mod-system/js/wh/testframework";
