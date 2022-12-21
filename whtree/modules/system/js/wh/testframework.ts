/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/semi */
/* eslint-disable no-var */
/// @ts-nocheck -- TODO ... TestFramework is a LOT to port ... for now we're just providing types

import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';

import * as domfocus from "dompack/browserfix/focus";
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';
import jstestsrpc from '@mod-system/js/internal/jstests.rpc.json';

import * as whtest from '@webhare/test';
import * as test from 'dompack/testframework';
import * as pointer from 'dompack/testframework/pointer';
import * as keyboard from 'dompack/testframework/keyboard';
import { Annotation } from '@webhare/test/src/checks';

export {
  eq,
  sleep,
  eqMatch,
  eqProps,
  assert
} from '@webhare/test';

export {
  canClick as canClick,
  canClick as isElementClickable,
  click as click,
  sendMouseGesture as sendMouseGesture,
  getValidatedElementFromPoint as getValidatedElementFromPoint,
  startExternalFileDrag,
  getCurrentDragDataStore,
  cancelDrag
} from 'dompack/testframework/pointer';

export {
  waitForEvent as waitForEvent
  , simulateTabKey as simulateTabKey
  , focus
  , waitUIFree
} from 'dompack/testframework';

export { generateKeyboardEvent as generateKeyboardEvent } from 'dompack/testframework/keyboard';

//basic test functions
var testfw = window.parent ? window.parent.__testframework : null;
whtest.setupLogging({ onLog: (...args) => { console.log(...args); testfw.log(...args); } })

let callbacks = null;

// Returns something like an ecmascript completion record
function setTestSuiteCallbacks(cb) {
  callbacks = cb;
}

function initialize_tests(steps) {
  testfw.runTestSteps(steps, setTestSuiteCallbacks);
}

function rewriteNodeAttributes(node) {
  // Make sure the order of the attributes is predictable, by getting them, removing them all and reinserting them
  // with a function that tries to keep it stable.
  var attrs = domlevel.getAllAttributes(node);
  var keys = Object.keys(attrs);
  for (var i = 0; i < keys.length; ++i)
    node.removeAttribute(keys[i]);
  domlevel.setAttributes(node, attrs);
}

function isequal(a, b) {
  try {
    test.eq(a, b, '');
    return true;
  } catch (e) {
    return false;
  }
}

export function registerTests(steps) {
  //get our parent test framework
  if (!testfw)
    throw new Error("This page is not being invoked by the test framework");

  let lasttestname, finalsteps = [];
  for (let step of steps) {
    if (!step)
      continue;  //strip empty items. allows you to be careless with commas when commenting out tests

    if (typeof step == "string") {
      lasttestname = step;
      continue;
    }

    if (typeof step == "function")
      step = { test: step };

    if (lasttestname && !step.name) { //merge name into the next test for more reliable counters
      step.name = lasttestname;
      lasttestname = null;
    }
    finalsteps.push(step);
  }
  dompack.onDomReady(() => initialize_tests(finalsteps));
}
export function getTestArgument(idx) {
  if (idx > testfw.args.length)
    throw new Error("No argument #" + idx);
  return testfw.args[idx];
}
function logExplanation(explanation) {
  if (typeof explanation == "function")
    explanation = explanation();
  console.error(explanation);
  testfw.log("* " + explanation + "\n");
}

export function eqHTML(expected, actual, explanation) {
  var fixer = document.createElement("div");

  // Normalize stuff by parsing into DOM and then extracing again
  fixer.innerHTML = expected;
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  actual = fixer.innerHTML;
  if (expected == actual)
    return;

  // Extra round. May fix some stuff
  fixer.innerHTML = expected;
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  actual = fixer.innerHTML;
  if (expected == actual)
    return;

  // Firefox has problems with attribute ordering. Rewrite all attributes to get them in the same order.
  fixer.innerHTML = expected;
  var list = fixer.getElementsByTagName('*');
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  expected = fixer.innerHTML;
  fixer.innerHTML = actual;
  list = fixer.getElementsByTagName('*');
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  actual = fixer.innerHTML;

  test.eq(expected, actual, explanation);
}

export function eqIn(expected_in, actual, explanation) {
  for (var i = 0; i < expected_in.length; ++i)
    if (isequal(expected_in[i], actual))
      return;

  expected_in = unescape(escape(expected_in).split('%u').join('/u'));
  actual = unescape(escape(actual).split('%u').join('/u'));

  if (explanation)
    logExplanation(explanation);

  console.trace();
  console.log("testEqIn fails: expected one of ", expected_in);
  testfw.log("testEqIn fails: expected one of " + expected_in);

  console.log("testEqIn fails: actual ", actual);
  testfw.log("testEqIn fails: actual " + actual);
  throw new Error("testEqIn failed");
}

export function eqFloat(expected, actual, delta, explanation) {
  if (Math.abs(expected - actual) <= delta)
    return;

  var expected_str = expected;
  var actual_str = actual;

  try { expected_str = typeof expected == "string" ? unescape(escape(expected).split('%u').join('/u')) : JSON.stringify(expected); } catch (e) { }
  try { actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual); } catch (e) { }

  if (explanation)
    logExplanation(explanation);

  console.log("testEq fails: expected", expected_str);
  testfw.log("testEq fails: expected " + (typeof expected_str == "string" ? "'" + expected_str + "'" : expected_str));

  console.log("testEq fails: actual  ", actual_str);
  testfw.log("testEq fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  if (typeof expected == "string" && typeof actual == "string") {
    testfw.log("E: " + encodeURIComponent(expected));
    testfw.log("A: " + encodeURIComponent(actual));
  }

  test.eq(expected, actual);
}

function testTrue(actual, explanation) {
  test.eq(true, Boolean(actual), explanation);
}

function testFalse(actual, explanation) {
  test.eq(false, Boolean(actual), explanation);
}


export async function throws(expect: RegExp, func_or_promise: Promise<unknown> | (() => unknown), annotation?: Annotation): Promise<Error>;
export async function throws(func_or_promise: Promise<unknown> | (() => unknown), annotation?: Annotation): Promise<Error>;
//temporay wrapper to support old-style syntax
export async function throws(p1: RegExp | Promise<unknown> | (() => unknown), p2?: Promise<unknown> | (() => unknown) | Annotation, p3?: Annotation) {
  if (p1 instanceof RegExp)
    return await whtest.throws(p1, p2, p3);

  let exc = await whtest.throws(/.*/, p1, p2);
  console.warn("As soon as this module supports 5.2 only, explicitly specify the throw mask. Thrown was: " + exc.toString());
  return exc;
}

export function findElementWithText(doc, tagname, text) {
  var els = (doc || getDoc()).querySelectorAll(tagname);
  for (var i = 0; i < els.length; ++i)
    if (els[i].textContent == text)
      return els[i];
  return null;
}

/// Returns a promise for when all gestures have been processed
export function gesturesDone() {
  return new Promise(resolve => window.waitForGestures(resolve));
}

export function dragTransition(pos) {
  // Decelerate more than accelerate
  let transition = p => Math.pow(p, 2);
  let easeOut = 1 - transition(1 - pos);
  let easeInOut = (pos <= 0.5 ? transition(2 * pos) : (2 - transition(2 * (1 - pos)))) / 2;
  return easeOut * easeInOut;
}

export async function pressKey(key, options) {
  if (!testfw.haveDevtoolsUplink())
    return await keyboard.pressKey(key, options);

  return await testfw.sendDevtoolsRequest({ type: "pressKeys", keys: keyboard.normalizeKeys(key, options), options });
}

//ADDME non-LMB support for the non-haveDevtoolsUplink paths
export async function asyncMouseMove(x, y, options) {
  if (!testfw.haveDevtoolsUplink()) {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), clientx: x, clienty: y }]);
    return;
  }

  y += test.getWin().frameElement.getBoundingClientRect().top; //devtools see the full page, so add our testiframe position
  return await testfw.sendDevtoolsRequest({ type: "mouseMove", x, y, options });
}
export async function asyncMouseDown(type, options) {
  if (!testfw.haveDevtoolsUplink()) {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), down: 0 }]);
    return;
  }
  return await testfw.sendDevtoolsRequest({ type: "mouseDown", options });
}
export async function asyncMouseUp(type, options) {
  if (!testfw.haveDevtoolsUplink()) {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), up: 0 }]);
    return;
  }
  return await testfw.sendDevtoolsRequest({ type: "mouseUp", options });
}
export async function asyncMouseClick(x, y, options) {
  if (!testfw.haveDevtoolsUplink()) {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), clientx: x, clienty: y, down: 0 }]);
    await pointer.sendMouseGesture([{ up: 0 }]);
    return;
  }

  y += test.getWin().frameElement.getBoundingClientRect().top; //devtools see the full page, so add our testiframe position
  return await testfw.sendDevtoolsRequest({ type: "mouseClick", x, y, options });
}

class FakeUploadSession {
  constructor(files, donecallback) {
    this.blobs = [];
    this.files = files;
    this.donecallback = donecallback;
    files.forEach(file => this.blobs.push(null));
  }
  runUpload(inputnode, callback) {
    var self = this;
    this.inputnode = inputnode;

    this.files.forEach(function(file, idx) {
      getFileFromURL(file.url, file.filename).then(blob => self.doneUpload(blob, idx));
    });
  }
  doneUpload(blob, idx) {
    if (this.blobs[idx])
      throw new Error("Duplicate upload completion for blob #" + idx);
    this.blobs[idx] = blob;
    if (this.blobs.filter(val => val).length < this.blobs.length) //we don't have all files yet
      return;

    dompack.dispatchCustomEvent(this.inputnode, 'wh:upload-fake', { bubbles: false, cancelable: false, detail: { files: this.blobs } });
    if (this.donecallback)
      setTimeout(() => this.donecallback(), 1);
  }
}

export function prepareUploadTest(node, files, donecallback) {
  if (window.top.wh_testapi_fakeupload)
    throw new Error("The window already has a pending upload");

  var uploadclass = new FakeUploadSession(files, donecallback);
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
}

export async function prepareUpload(files) {
  let deferred = dompack.createDeferred();
  var uploadclass = new FakeUploadSession(files, function() { deferred.resolve(); });
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
  await deferred.promise;
}

export function getOpenMenu() {
  return qSA('ul:last-of-type.wh-menulist.open')[0] || null;
}
export function getOpenMenuItem(containstext) {
  let menu = getOpenMenu();
  if (!menu)
    return null;
  let item = dompack.qSA(menu, 'li').filter(_ => _.textContent.includes(containstext));
  if (item.length > 1)
    throw new Error("Multiple items contain the text '" + containstext + "'");
  return item[0] || null;
}
export function getWin() {
  return testfw.getFrameRecord().win;
}
export function getDoc() {
  return testfw.getFrameRecord().doc;
}
export function setFormsapiFileElement(el, filedata, filename) {
  //formsapi permits a hack to allow us to fake submissions to input type=file fields
  //unfortunately we can't change the type of an input element, so we'll have to recreate it

  var newinput = el.ownerDocument.createElement('input');
  newinput.name = el.name + '$filename=' + filename;
  newinput.type = 'text';
  newinput.value = filedata;
  newinput.id = el.id;
  el.parentNode.replaceChild(newinput, el);

  //  $(el).destroy();
}

export function fill(element, newvalue) {
  element = pointer._resolveToSingleElement(element);
  element.focus();
  dompack.changeValue(element, newvalue);
}
export function fillUpload(element, files) {
  let blobs = files.map(file => {
    if (!file.mimetype)
      throw new Error("Missing mimetype");
    if (!file.filename)
      throw new Error("Missing filename");

    let output = new Blob([file.data], { type: file.mimetype });
    output.name = file.filename;
    return output;
  });
  Object.defineProperty(element, 'files', { get: function() { return blobs; }, configurable: true });
}
export function getTestSiteRoot() {
  var topdoc = window.parent.document.documentElement;
  if (!topdoc.dataset.testsiteroot)
    throw new Error("No testsite specified for this test");
  return (new URL(topdoc.dataset.testsiteroot, location.href)).toString();
}

export function getListViewHeader(text) {
  var headers = qSA('#listview .listheader > span').filter(node => node.textContent.includes(text));
  if (headers.length > 1)
    console.error("Multiple header matches for '" + text + "'");
  return headers.length == 1 ? headers[0] : null;
}
export function getListViewRow(text) { //simply reget it for every test, as list may rerender at unspecifide times
  var rows = qSA('#listview .listrow').filter(node => node.textContent.includes(text));
  if (rows.length > 1)
    console.error("Multiple row matches for '" + text + "'");
  return rows.length == 1 ? rows[0] : null;
}
export function getListViewExpanded(row) {
  if (row.querySelector(".fa-caret-down"))
    return true;
  if (row.querySelector(".fa-caret-right"))
    return false;
  return null;
}

//Set up overloads for both call approaches (with and without starting element)
export function qS<E extends Element = Element>(startnode: ParentNode, selector: string): E | null;
export function qS<E extends Element = Element>(selector: string): E | null;

export function qS<E extends Element>(node_or_selector: ParentNode | string, selector?: string): E | null {
  if (typeof node_or_selector !== 'string')
    return node_or_selector.querySelector(selector);

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return iframe.contentDocument.querySelector(node_or_selector);
}

//Set up overloads for both call approaches (with and without starting element)
export function qSA<E extends Element = Element>(startnode: ParentNode, selector: string): E[];
export function qSA<E extends Element = Element>(selector: string): E[];

export function qSA<E extends Element>(node_or_selector: ParentNode | string, selector?: string): E[] {
  if (typeof node_or_selector !== 'string')
    return Array.from(node_or_selector.querySelectorAll(selector));

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return Array.from(iframe.contentDocument.querySelectorAll(node_or_selector));
}

export async function invoke(libfunc, ...params) {
  if (!libfunc.includes('#')) {
    libfunc += '#' + params[0];
    params.shift();
    console.warn("The two-parameter form of test.invoke() is deprecated. Replace the first two parameters with:", libfunc);
  }

  console.log(`test.invoke ${libfunc}`, params);
  let result = await jstestsrpc.invoke(libfunc, params);
  if (typeof result == "object" && result && result.__outputtoolsdata) {
    dompack.dispatchCustomEvent(window, 'wh:outputtools-extradata', { bubbles: false, cancelable: false, detail: result.__outputtoolsdata });
    delete result.__outputtoolsdata;
  }
  console.log(`test.invoke result`, result);

  return result;
}
export function getWrdLogoutUrl(returnurl) {
  return new URL('/.wrd/auth/logout.shtml?b=' + encodeURIComponent(returnurl.split('/').slice(3).join('/')), returnurl).toString();
}
export function wrdAuthLogout() {
  let redirectto = getWrdLogoutUrl(getWin().location.href);
  window.parent.document.querySelector('#testframeholder iframe').src = redirectto;
}
export async function writeLogMarker(text) {
  await invoke("mod::system/lib/testframework.whlib#WriteLogMarker", text);
}

export async function wait(waitfor, annotation?) {
  if (annotation && typeof annotation !== "string")
    throw new Error("wait()ing on multiple things is no longer supported");

  return await callbacks.executeWait(waitfor);
}

// email: The email address to look for
// options.timeout: The timeout in ms, defaults to 0 (don't wait)
// options.count: The number of emails to wait for, defaults to 1

interface RetrieveEmailOptions {
  /** If TRUE, don't remove emails from queue */
  peekonly?: boolean;
  /** options.timeout Timeout in milliseconds, max 60000 */
  timeout?: number;
  /** options.count Number of mails expected within the timeout. Defaults to 1 */
  count?: number;
  /** options.returnallmail Return all mail, not up to 'count'. */
  returnallmail?: boolean;
  /** options.scanaheaduntil If set, also look at future tasks until this date */
  scanaheaduntil?: Date | string;
}

export async function waitForEmails(addressmask: string, options?: RetrieveEmailOptions) {
  let emails = await invoke("mod::system/lib/testframework.whlib#ExtractAllMailFor", addressmask, options);
  for (const email of emails) {
    email.doc = document.createElement('div');
    email.doc.style.display = "none";
    email.doc.innerHTML = email.html;
  }
  return emails;
}

export async function subtest(name) {
  callbacks.subtest(name);
}

export async function addFrame(name, { width }) {
  return callbacks.setFrame(name, "add", { width });
}

export async function updateFrame(name, { width }) {
  return callbacks.setFrame(name, "update", { width });
}

export async function removeFrame(name) {
  return callbacks.setFrame(name, "delete");
}

export async function selectFrame(name) {
  return callbacks.setFrame(name, "select");
}

export async function load(page) {
  if (typeof page != "string") {
    console.error(`test.load expects a string, got`, page);
    throw new Error(`test.load exects a string`);
  }

  let topwhdebug = new URL(top.location.href).searchParams.get("wh-debug");
  if (topwhdebug !== null) { //something is set... should override loaded urls unless the load explicitly sets wh-debug. allows passing eg ?wh-debug=apr
    let gotourl = new URL(page);
    if (gotourl.searchParams.get("wh-debug") === null) {
      gotourl.searchParams.set("wh-debug", topwhdebug);
      page = gotourl.toString();
    }
  }

  getWin().location.href = page;
  await wait("load");
}

export function pasteHTML(content) {
  let target = domfocus.getCurrentlyFocusedElement();
  let htmltext = typeof content == 'string' ? content : content.innerHTML;

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  let evt = target.ownerDocument.createEvent('Event');

  let cpdata = {
    types: ['text/html'],
    getData: type => {
      if (type != 'text/html')
        return null;
      return htmltext;
    }
  };

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  let dodefault = target.dispatchEvent(evt);
  if (dodefault) {
    console.error("FIXME: default action!");
  }
  return dodefault;
}

export async function getFileFromURL(url, filename) {
  const defer = dompack.createDeferred();
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);

  xhr.responseType = 'blob';
  xhr.onload = function(e) {
    console.log('onload', this, e, this.response);
    if (this.status == 200) {
      // Create a blob with the response's Content-Type as file type
      const file = createFileObject([this.response], filename, { type: this.response.type });
      defer.resolve(file);
    } else
      defer.reject(new Error(`Error ${this.status} retrieving ${url}`));
  };
  xhr.onerror = function(e) { defer.reject(new Error(`Error ${e} retrieving ${url}`)); };
  xhr.send();
  return defer.promise;
}

function createFileObject(data, name, opts) {
  try {
    return new File(data, name, opts);
  } catch (e) {
    // IE 11 workaround, it does not have a File constructor. Use a blob and add a filename
    const file = new Blob(data, opts);
    file.name = name;
    return file;
  }
}

export function canFocus(element) {
  element = pointer._resolveToSingleElement(element);
  return domfocus.canFocusTo(element);
}

export function hasFocus(element) {
  element = pointer._resolveToSingleElement(element);
  return element == domfocus.getActiveElement(element.ownerDocument);
}

/** Get pxl log entries
    @param eventtypefilter - Expression to match on event type
    @returns Filtered log entries, or an empty array if the log hasn't started yet*/
export function getPxlLog(eventtypefilter) {
  let log = getWin().whPxlLog || [];
  if (eventtypefilter)
    log = log.filter(evt => evt.event.match(eventtypefilter));
  return log;
}

export function getWebhareVersionNumber() {
  return parseInt(window.parent.document.documentElement.dataset.webhareversionnumber);
}

export const keyboardCopyModifier = { alt: browser.getPlatform() == 'mac', ctrl: browser.getPlatform() != 'mac' }
export const keyboardLinkModifier = { ctrl: true, shift: browser.getPlatform() != 'mac' }
export const keyboardMultiSelectModifier = { cmd: browser.getPlatform() == 'mac', ctrl: browser.getPlatform() != 'mac' }

export {
  testTrue as true             //deprecated! use test.assert(...) in 5.2+
  , testFalse as false         //deprecated! use test.assert(!...) in 5.2+
};
