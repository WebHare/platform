import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';

import * as domfocus from "dompack/browserfix/focus";
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';

import * as whtest from '@webhare/test';
import * as pointer from 'dompack/testframework/pointer';
import * as keyboard from 'dompack/testframework/keyboard';
import type { Annotation, WaitOptions, WaitRetVal } from '@webhare/test/src/checks';
import { invoke } from "@mod-platform/js/testing/whtest";
import { isFormControl } from '@webhare/dompack';
import type { TestFramework, TestStep, TestWaitItem } from '@mod-system/web/systemroot/jstests/testsuite';
import { throwError } from '@webhare/std';
import { TestMonitor } from '@webhare/test/src/monitor';
import { __getTestSuiteCallbacks, __setTestSuiteCallbacks, waitForUI } from "@webhare/test-frontend";

export {
  eq,
  sleep,
  eqPartial,
  eqMatch,
  eqProps,
  assert,
  throws,
  waitToggled,
  waitForEvent,
} from '@webhare/test';

export { waitForUI, addFrame, selectFrame, removeFrame, updateFrame } from "@webhare/test-frontend";

export { waitForEmails } from "@mod-platform/js/testing/whtest.ts";

export {
  canClick as canClick,
  canClick as isElementClickable,
  click as click,
  sendMouseGesture as sendMouseGesture,
  getValidatedElementFromPoint as getValidatedElementFromPoint,
  startExternalFileDrag,
  getCurrentDragDataStore,
  cancelDrag,
  focus
} from 'dompack/testframework/pointer';

export {
  findElement,
  waitForElement,
  type Selector
} from "../internal/tests/waitforelement";

export { waitUIFree } from '@webhare/dompack/src/busy';

export { generateKeyboardEvent as generateKeyboardEvent } from 'dompack/testframework/keyboard';

export { invoke };

export type { TestWaitItem };

//basic test functions
let testfw: TestFramework | undefined;
if (typeof window !== 'undefined') {
  testfw = window.top?.__testframework;
  whtest.setupLogging({ onLog: (...args) => { console.log(...args); testfw!.log(...args); } });
}

export type TestFrameWorkCallbacks = {
  executeWait: (item: TestWaitItem) => Promise<unknown>;
  subtest: (name: string) => void;
  setFrame: (name: string, type: "add" | "update" | "delete" | "select", options?: { width: number }) => Promise<void>;
};


function rewriteNodeAttributes(node: HTMLElement) {
  // Make sure the order of the attributes is predictable, by getting them, removing them all and reinserting them
  // with a function that tries to keep it stable.
  const attrs = domlevel.getAllAttributes(node);
  const keys = Object.keys(attrs);
  for (let i = 0; i < keys.length; ++i)
    node.removeAttribute(keys[i]);
  domlevel.setAttributes(node, attrs);
}

export type RegisteredTestStep = TestStep | string | NonNullable<TestStep["test"]>;
export type RegisteredTestSteps = RegisteredTestStep[];

export function runTests(steps: RegisteredTestSteps) {
  if (typeof window === "undefined" && typeof process !== "undefined") {
    console.error("This script should be run in a browser test environment");
    process.exit(1);
  }
  dompack.onDomReady(() => runActualTests(steps));
}

function runActualTests(steps: RegisteredTestSteps) {
  //get our parent test framework
  if (!testfw)
    throw new Error("This page is not being invoked by the test framework");

  /* runTests runs inside the test script frame and is (re)loaded for every test, so we just need
     one global monitor*/
  const monitor = new TestMonitor;
  //TODO get a callback from monitor when wait states change, and then update the Wait indicator in the toplevel frame

  let lasttestname;
  const finalsteps: TestStep[] = [];
  for (let step of steps) {
    if (!step)
      continue;  //strip empty items. allows you to be careless with commas when commenting out tests

    if (typeof step === "string") {
      lasttestname = step;
      continue;
    }

    if (typeof step === "function")
      step = { test: step as () => void };

    if (lasttestname && !step.name) { //merge name into the next test for more reliable counters
      step.name = lasttestname;
      lasttestname = null;
    }
    finalsteps.push(step);
  }

  //NOTE: this is a cross-frame call to our persistent parent
  testfw.runTestSteps(finalsteps, __setTestSuiteCallbacks, () => monitor.abort());
}

export function getTestArgument(idx: number) {
  if (!testfw?.args)
    throw new Error(`No test started yet`);
  if (idx > testfw.args.length)
    throw new Error("No argument #" + idx);
  return testfw.args[idx];
}
function logExplanation(explanation: Annotation) {
  if (typeof explanation === "function")
    explanation = explanation();
  console.error(explanation);
  testfw?.log("* " + explanation + "\n");
}

export function eqHTML(expected: string, actual: string, explanation?: Annotation) {
  const fixer = document.createElement("div");

  // Normalize stuff by parsing into DOM and then extracing again
  fixer.innerHTML = expected;
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  actual = fixer.innerHTML;
  if (expected === actual)
    return;

  // Extra round. May fix some stuff
  fixer.innerHTML = expected;
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  actual = fixer.innerHTML;
  if (expected === actual)
    return;

  // Firefox has problems with attribute ordering. Rewrite all attributes to get them in the same order.
  fixer.innerHTML = expected;
  let list = fixer.getElementsByTagName('*') as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  list = fixer.getElementsByTagName('*') as HTMLCollectionOf<HTMLElement>;
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  actual = fixer.innerHTML;

  whtest.eq(expected, actual, explanation);
}

export function eqFloat(expected: number, actual: number, delta: number, explanation?: Annotation) {
  if (Math.abs(expected - actual) <= delta)
    return;

  const expected_str = JSON.stringify(expected);
  const actual_str = JSON.stringify(actual);

  if (explanation)
    logExplanation(explanation);

  console.log("testEq fails: expected", expected_str);
  testfw?.log("testEq fails: expected " + (typeof expected_str === "string" ? "'" + expected_str + "'" : expected_str));

  console.log("testEq fails: actual  ", actual_str);
  testfw?.log("testEq fails: actual " + (typeof actual_str === "string" ? "'" + actual_str + "'" : actual_str));

  if (typeof expected === "string" && typeof actual === "string") {
    testfw?.log("E: " + encodeURIComponent(expected));
    testfw?.log("A: " + encodeURIComponent(actual));
  }

  whtest.eq(expected, actual);
}

export function dragTransition(pos: number) {
  // Decelerate more than accelerate
  const transition = (p: number) => Math.pow(p, 2);
  const easeOut = 1 - transition(1 - pos);
  const easeInOut = (pos <= 0.5 ? transition(2 * pos) : (2 - transition(2 * (1 - pos)))) / 2;
  return easeOut * easeInOut;
}

export async function pressKey(key: string | string[], options?: keyboard.KeyboardModifierOptions) {
  if (!testfw?.haveDevtoolsUplink())
    return await keyboard.pressKey(key, options);

  return await testfw.sendDevtoolsRequest({ type: "pressKeys", keys: keyboard.normalizeKeys(key, options), options });
}

export function getOpenMenu() {
  return qSA('ul:last-of-type.wh-menulist.open')[0] || null;
}
export function getOpenMenuItem(containstext: string) {
  const menu = getOpenMenu();
  if (!menu)
    return null;
  const item = dompack.qSA(menu, 'li').filter(_ => _.textContent!.includes(containstext));
  if (item.length > 1)
    throw new Error("Multiple items contain the text '" + containstext + "'");
  return item[0] || null;
}
export function getWin(): WindowProxy {
  return testfw?.getFrameRecord().win || throwError("Not running in a test page");
}
export function getDoc(): Document {
  return testfw?.getFrameRecord().doc || throwError("Not running in a test page");
}
/** Focus and fill an element, triggering any input/change handlers */
export function fill(element: pointer.ValidElementTarget, newvalue: string | number | boolean): void {
  element = pointer._resolveToSingleElement(element);
  if (!isFormControl(element))
    throw new Error(`Cannot use test.fill on an element that is not a form control, got a ${JSON.stringify(element.tagName)}`);
  element.focus();
  dompack.changeValue(element, newvalue);
}
export function fillUpload(element: pointer.ValidElementTarget, files: Array<{ data: BlobPart; filename: string; mimetype: string }>) {
  element = pointer._resolveToSingleElement(element);
  if (!("files" in element))
    throw new Error(`Cannot use test.fill on an element that doesn't have a "files" property, got a ${JSON.stringify(element)}`);

  const blobs = files.map(file => {
    if (!file.mimetype)
      throw new Error("Missing mimetype");
    if (!file.filename)
      throw new Error("Missing filename");

    const output = new Blob([file.data], { type: file.mimetype });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (output as any).name = file.filename; //  Make it look like a File object
    return output;
  });
  Object.defineProperty(element, 'files', { get: function () { return blobs; }, configurable: true });
}

export function getTestSiteRoot(): string {
  if (typeof window === 'undefined')
    throw new Error("getTestSiteRoot is only available in frontend tests");

  const topdoc = window.parent.document.documentElement;
  if (!topdoc.dataset.testsiteroot)
    throw new Error("No testsite specified for this test");
  return (new URL(topdoc.dataset.testsiteroot, location.href)).toString();
}

type CombineTypes<T extends keyof HTMLInputElement & keyof HTMLSelectElement> = { [K in T]: HTMLInputElement[K] | HTMLSelectElement[K] };
type UncombinableProps = "addEventListener" | "labels" | "remove" | "removeEventListener" | "type";

/* When testing it's not really worth the effort to explicitly type/cast the returnvalues of test.qS(A). We'll return a
   reasonable superset of <select>/<input> (so you get all the form/value props) and cast some of the often used DOM navigation props */
export interface TestQueriedElement extends Omit<HTMLInputElement, UncombinableProps>, Omit<HTMLSelectElement, UncombinableProps>, CombineTypes<UncombinableProps> {
  previousSibling: TestQueriedElement | null;
  nextSibling: TestQueriedElement | null;
  previousElementSibling: TestQueriedElement | null;
  nextElementSibling: TestQueriedElement | null;
}

//Set up overloads for both call approaches (with and without starting element)
export function qS<E extends Element = TestQueriedElement>(startnode: ParentNode, selector: string): E | null;
export function qS<E extends Element = TestQueriedElement>(selector: string): E | null;

/** Find an element in the test window
    @param node_or_selector - Starting node (optional)
    @param selector - CSS selector to use
    @returns The first matching element or 'null' if not matched */
export function qS<E extends Element = TestQueriedElement>(node_or_selector: ParentNode | string, selector?: string): E | null {
  if (typeof node_or_selector !== 'string')
    return node_or_selector.querySelector(selector as string);

  const iframe = window.parent.document.querySelector<HTMLIFrameElement>('#testframeholder iframe')!;
  return iframe.contentDocument!.querySelector(node_or_selector);
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

//Set up overloads for both call approaches (with and without starting element)
export function qR<E extends HTMLElement = TestQueriedElement>(startnode: ParentNode, selector: string): E;
export function qR<E extends HTMLElement = TestQueriedElement>(selector: string): E;

/** Find a unique element in the test window, throw if not found
    @param node_or_selector - Starting node (optional)
    @param selector - CSS selector to use
    @returns The only matching element. Throws if not found */
export function qR<E extends HTMLElement = TestQueriedElement>(node_or_selector: ParentNode | string, selector?: string): E {
  const matches = qSA<E>(node_or_selector as ParentNode, selector as string);
  if (matches.length === 1)
    return matches[0];

  if (typeof node_or_selector !== 'string') {
    console.error(`${matches.length} elements match selector \`${selector}\` with startingpoint`, node_or_selector, matches);
    throw new Error(`${matches.length} elements match selector \`${selector}\` given startingpoint '${node_or_selector.nodeName}'`);
  } else {
    console.error(`${matches.length} elements match selector \`${node_or_selector}\` in the testframe`, matches);
    throw new Error(`${matches.length} elements match selector \`${node_or_selector}\` in the testframe`);
  }
}

export function getWrdLogoutURL(returnurl: string) {
  return new URL('/.wrd/auth/logout.shtml?b=' + encodeURIComponent(returnurl.split('/').slice(3).join('/')), returnurl).toString();
}
export function wrdAuthLogout() {
  const redirectto = getWrdLogoutURL(getWin().location.href);
  window.parent.document.querySelector<HTMLIFrameElement>('#testframeholder iframe')!.src = redirectto;
}
export async function writeLogMarker(text: string) {
  await invoke("mod::system/lib/testframework.whlib#WriteLogMarker", text);
}

export async function wait<T>(waitfor: (() => T | Promise<T>) | Promise<T>, options?: WaitOptions<T>): WaitRetVal<T>;
export async function wait<T>(waitfor: (doc: Document, win: Window) => T | Promise<T>, annotation?: string): Promise<NonNullable<T>>;
export async function wait(waitfor: TestWaitItem, annotation?: string): Promise<void>;


export async function wait<T>(waitfor: TestWaitItem | (() => T | Promise<T>) | Promise<T>, options?: WaitOptions<T>) {
  if (typeof waitfor === "string" || typeof waitfor === "number")
    return await __getTestSuiteCallbacks()!.executeWait(waitfor); //forward to old wait API

  if (typeof waitfor === "function" && waitfor.length === 2) {
    console.warn("Rebinding wait() caller, remove its doc/win arguments!");
    waitfor = () => (waitfor as (doc: Document, win: Window) => unknown)(getDoc(), getWin());
  }
  return await whtest.wait(waitfor as (() => T | Promise<T>) | Promise<T>, options);
}

export function subtest(name: string) {
  __getTestSuiteCallbacks().subtest(name);
}

// eslint-disable-next-line @typescript-eslint/no-shadow
export async function load(page: string, { waitUI = true } = {}): Promise<void> {
  if (typeof page !== "string") {
    console.error(`test.load expects a string, got`, page);
    throw new Error(`test.load exects a string`);
  }

  const topwhdebug = new URL(window.top!.location.href).searchParams.get("wh-debug");
  if (topwhdebug !== null) { //something is set... should override loaded urls unless the load explicitly sets wh-debug. allows passing eg ?wh-debug=apr
    const gotourl = new URL(page);
    if (gotourl.searchParams.get("wh-debug") === null) {
      gotourl.searchParams.set("wh-debug", topwhdebug);
      page = gotourl.toString();
    }
  }

  getWin().location.href = page;
  await wait("load");
  if (waitUI)
    await waitForUI({ optional: true });
}

export function pasteHTML(content: string | HTMLElement) {
  const target = domfocus.getCurrentlyFocusedElement()!;
  const htmltext = typeof content === 'string' ? content : content.innerHTML;

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  const evt = target.ownerDocument.createEvent('Event');

  const cpdata = {
    types: ['text/html'],
    getData: (type: string) => {
      if (type !== 'text/html')
        return null;
      return htmltext;
    }
  };

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  const dodefault = target.dispatchEvent(evt);
  if (dodefault) {
    console.error("FIXME: default action!");
  }
  return dodefault;
}

export function canFocus(element: pointer.ValidElementTarget) {
  element = pointer._resolveToSingleElement(element);
  return domfocus.canFocusTo(element);
}

export function hasFocus(element: pointer.ValidElementTarget) {
  element = pointer._resolveToSingleElement(element);
  return element === domfocus.getActiveElement(element.ownerDocument);
}

export function getWebhareVersionNumber() {
  return parseInt(window.parent.document.documentElement.dataset.webhareversionnumber!);
}

export const keyboardCopyModifier = { alt: browser.getPlatform() === 'mac', ctrl: browser.getPlatform() !== 'mac' };
export const keyboardLinkModifier = { ctrl: true, shift: browser.getPlatform() !== 'mac' };
export const keyboardMultiSelectModifier = { cmd: browser.getPlatform() === 'mac', ctrl: browser.getPlatform() !== 'mac' };

/** Wait for the UI to be ready (UI is marked busy by flagUIBusy) */
export async function waitUI() { //eases transition to the less-flexible @webhare/test wait()
  return await __getTestSuiteCallbacks()!.executeWait('ui');
}

/** Wait for navigation to complete  */
export async function waitNavigation() { //eases transition to the less-flexible @webhare/test wait()
  return await __getTestSuiteCallbacks()!.executeWait('load');
}

// TODO @deprecated We're renaming run to runTests to avoid a conflict with \@webhare/cli's run() - once everyone is WH5.7+
export const registerTests = runTests;
