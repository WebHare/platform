// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-frontend" {
}

/* @webhare/test-frontend is a superset of @webhare/test with additional browser/frontend test support

   (this felt more friendly that having to add dozens of throwing APIs "not in the frontend" to @webhare/test)
   */

import { wait as oldWait, getWin, type TestFrameWorkCallbacks } from "@mod-system/js/wh/testframework";
import { startTime } from "@mod-platform/js/testing/whtest";
import { omit } from "@webhare/std";
import { rpc } from "@webhare/rpc";
import "@webhare/deps/temporal-polyfill"; //many frontend tests use rpcs (directly/indirectly eg pxl) which require Temporal.Instant

let callbacks: TestFrameWorkCallbacks | null = null;

//We're unsplitting test.wait() again. We shouldn't have to wind up with 10 different wait methods like old testfw did with waitForElement

/** Wait for the current UIBusyLock (flagUIBusy) to clear if any
 *
 * @throws If that the UI has never been busy since the last wait and the 'optional' flag was not set (and inside the current test step) */
export async function waitForUI({ optional = false } = {}): Promise<void> {
  await oldWait(optional ? "ui-nocheck" : "ui");
}

/** Expect a pageload to be triggered by the callback */
export async function expectLoad<T>(cb: () => T | Promise<T>, { waitUI = true } = {}): Promise<T> {
  //FIXME verify no earlier load is pending
  const result = await cb();
  await waitForLoad({ waitUI });
  return result;
}

/** Wait for a pageload to complete, triggered by either await load() or an action by the page  */
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
  async function handleRequestFiles(e: WindowEventMap["wh:requestfiles"]) {
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
  }

  getWin().addEventListener("wh:requestfiles", e => void handleRequestFiles(e), { once: true });
}


/** Expose an API for use by frontend tests in a type-safe way
 * @typeParam T - Type of the API to expose
 * @param name - Name of the API
 * @param api - API object
   @example In your frontend code:
```
import { expose } from "@webhare/test-frontend";
const authApi = expose("authApi", { isLoggedIn, login });
export type AuthApi = typeof authApi;
```
@see {@link importExposed} to access the exposed API

*/
export function expose<T>(name: string, api: T): T {
  try {
    window.top?.__testframework?.expose(name, api);
  } catch (e) {
    console.log(`Failed to register exposed API ${name}`, e);
  }
  return api;
}

/** Retrieve an exposed API
 * @typeParam T - Type of the expoed API
 * @param name - Name of the API
   @example In your test code you would use:
```
import { type AuthApi } from "@mod-my/frontend";
const authApi = test.importExposed<authApi>("authApi");
```
@see {@link expose} to expose an API
*/
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
 * @param options - options
   - waitUI - Wait for the UI to be ready (default: true)
   - urlParams - URL parameters to add to the URL
 */
export async function load(page: string | URL, options?: { waitUI?: boolean; urlParams: Record<string, string> }): Promise<void> {
  const cururl = getWin().location.href;
  const gotourl = new URL(page, cururl === 'about:blank' ? window.location.href : cururl);
  if (options?.urlParams)
    for (const [key, value] of Object.entries(options?.urlParams))
      gotourl.searchParams.set(key, value);

  if (!gotourl.searchParams.has("wh-debug")) {
    const topwhdebug = new URL(window.top!.location.href).searchParams.get("wh-debug");
    if (topwhdebug)  //something is set... should override loaded urls unless the load explicitly sets wh-debug. allows passing eg ?wh-debug=apr
      gotourl.searchParams.set("wh-debug", topwhdebug);
  }

  getWin().location.href = gotourl.toString();
  await waitForLoad();
  if (options?.waitUI)
    await waitForUI({ optional: true });
}

/** Get the current state of the GTM datalayer */
export function getCurrentDataLayer(): Record<string, unknown> {
  let state = {};
  if (getWin().dataLayer)
    getWin().dataLayer.forEach(entry =>
      state = { ...state, ...structuredClone(omit(entry, ["event", "eventCallback"])) });
  return state;
}

/** Get pxl log as generated by the current page */
export async function getPxlLogLines({ start = startTime, session = "" } = {}) {
  return await rpc("platform:frontendtests").readPxlLog(start, session);
}

/** Describe an objref */
export async function describeObjRef(objref: string) {
  return await rpc("platform:frontendtests").describeObjRef(objref);
}

//our waitForPublishCompletion is expected to be compatible with the backend version
import type { waitForPublishCompletion as backendWaitForPublishCompletion } from "@webhare/test-backend";

export async function waitForPublishCompletion(...args: Parameters<typeof backendWaitForPublishCompletion>) {
  return await rpc("platform:frontendtests").waitForPublishCompletion(args);
}

export function getRoundedBoundingClientRect(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom)
  };
}

export async function addFrame(name: string, { width }: { width: number }) {
  return callbacks!.setFrame(name, "add", { width });
}

export async function updateFrame(name: string, { width }: { width: number }) {
  return callbacks!.setFrame(name, "update", { width });
}

export async function removeFrame(name: string) {
  return callbacks!.setFrame(name, "delete");
}

export async function selectFrame(name: string) {
  return callbacks!.setFrame(name, "select");
}

// Returns something like an ecmascript completion record
export function __setTestSuiteCallbacks(cb: TestFrameWorkCallbacks) {
  callbacks = cb;
}
export function __getTestSuiteCallbacks(): TestFrameWorkCallbacks {
  if (!callbacks)
    throw new Error("Test framework callbacks not set");
  return callbacks;
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
  hasFocus,
  pressKey
} from "@mod-system/js/wh/testframework";
