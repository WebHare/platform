/* @webhare/test-frontend is a superset of @webhare/test with additional browser/frontend test support

   (this felt more friendly that having to add dozens of throwing APIs "not in the frontend" to @webhare/test)
   */

import { wait as oldWait, load as oldLoad, getWin } from "@mod-system/js/wh/testframework";

//We're unsplitting test.wait() again. We shouldn't have to wind up with 10 different wait methods like old testfw did with waitForElement

/** Wait for the current UIBusyLock (flagUIBusy) to clear if any
 *
 * @throws If that the UI has never been busy since the last wait and the 'optional' flag was not set (and inside the current test step) */
export async function waitForUI({ optional = false } = {}): Promise<void> {
  await oldWait(optional ? "ui-nocheck" : "ui");
}

/** Wait for a pageload to complete, triggered by either await load() or an action by the page
 *
 * @throws If that the UI has never been busy since the last wait (and inside the current test step) */
export async function waitForLoad({ waitUI = true } = {}): Promise<void> {
  await oldWait("load");
  if (waitUI)
    await waitForUI({ optional: true });
}

export async function fetchAsFile(url: string, options?: { overrideContentType?: string }): Promise<File> {
  const fetchresult = await fetch(url);
  if (!fetchresult.ok)
    throw new Error(`Failed to fetch ${url}: ${fetchresult.statusText}`);

  return new File([await fetchresult.blob()],
    url.split("/").pop() || "file.dat",
    { type: options?.overrideContentType || fetchresult.headers.get("Content-Type") || "application/octet-stream" });
}

/** Prepare files for the next \@webhare/frontend upload request
 * @param list - List of files to prepare. If a string is passed, it will be fetched and turned into a File
*/
export function prepareUpload(list: Array<File | string>) {
  getWin().addEventListener("wh:requestfiles", async e => {
    e.preventDefault();

    const outlist: File[] = [];
    for (const item of list) {
      if (typeof item === "string") {
        outlist.push(await fetchAsFile(item));
      } else {
        outlist.push(item);
      }
    }
    e.detail.resolve(outlist);
  }, { once: true });
}


/** Expose an API for use by tests through importExposed */
export function expose<T>(name: string, api: T): T {
  try {
    if (window.top?.__testframework)
      window.top.__testframework.expose(name, api);
  } catch (e) {
    console.log(`Failed to register exposed API ${name}`, e);
  }
  return api;
}

/** Retrieve an exposed API */
export function importExposed<T>(name: string): T {
  let testfw;
  try {
    testfw = window.top?.__testframework;
  } catch (e) {
    //ignore
  }

  if (!testfw)
    throw new Error(`Testframework is not available`);

  return testfw.importExposed(name) as T;
}

/** Wait for a page to load
 * @param page - URL to load
 * @param waitUI - Wait for the UI to be ready (default: true)
 */
export async function load(page: string, { waitUI = true } = {}): Promise<void> {
  await oldLoad(page);
  if (waitUI)
    await waitForUI({ optional: true });
}

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";

//We individually vet APIs from testframework. We should only export APIs with proper typings!
export {
  canClick,
  findElement,
  waitForElement,
  qS,
  qSA,
  qR,
  getTestSiteRoot,
  click,
  fill,
  getWin,
  getDoc,
  startExternalFileDrag,
  sendMouseGesture,
} from "@mod-system/js/wh/testframework";
