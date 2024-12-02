/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as dombusy from '@webhare/dompack/impl/busy';

import { _resolveToSingleElement, _getFocusableElement } from './pointer';
export { canClick, click, focus, sendMouseGesture } from './pointer';
export { pressKey } from './keyboard';
export { log } from './log';
import IframeTestRunner from './iframetestrunner';

const testlist = [];
let running = false;
let testspa;
let StackTraceJS;
let scheduledruntests;

function fixupTestNames() {
  let lastname = 'unnamed test', lastcount = 0;
  testlist.forEach(step => {
    if (step.name) {
      lastname = step.name;
      lastcount = 1;
    } else {
      step.name = lastname + (lastcount ? " (" + ++lastcount + ")" : "");
    }
  });
}

function getTestHost() {
  try {
    return window.frameElement.ownerDocument.defaultView.dompackTestHost || null;
  } catch (ignore) //not an iframe or a security violation
  {
    return null;
  }
}


//run all registered tests
async function runTests() {
  const testhost = getTestHost();
  running = true;

  if (testhost) {
    StackTraceJS = testhost.StackTraceJS; //parent offers us an implementation so individual packages don't have to acquire stacktracejs
    testhost.onTestStart();
  }

  fixupTestNames();

  //mirrors runTestSteps(steps, setcallbacksfunc)
  testspa = new IframeTestRunner;

  let currenttest = 0, error = '';

  try {
    for (currenttest = 0; currenttest < testlist.length; ++currenttest) {
      if (testhost)
        testhost.onTestStep({ step: currenttest });
      await runTest(testlist[currenttest]);
    }
  } catch (e) {
    console.log("Got exception:", e);
    error = e.toString();
    if (StackTraceJS) {
      console.log("translating...");
      StackTraceJS.fromError(e).then(result => {
        const lines = result.map(f => `at ${f.functionName} (${f.fileName}:${f.lineNumber}:${f.columnNumber})\n`);
        console.log(lines.join(""));
      });
    }
  }

  if (testhost)
    testhost.onTestFinish({
      success: currenttest === testlist.length,
      donesteps: currenttest,
      error
    });
  else if (currenttest === testlist.length)
    console.log(`${currenttest} tests done!`);
  else
    console.warn(`${currenttest} tests ran, fail: ${error}`);
}

/// Run a specific test
async function runTest(teststep) {
  testspa.startingTest(teststep.name);

  const testresult = teststep.test();
  if (testresult && testresult.then) //we received a promise
    await testresult;
}

export function getWin() {
  if (testspa)
    return testspa.getWin();

  //webhare compatibility - remove if we can migrate webhare to iframetestrunner
  return top.document.querySelector('#testframeholder iframe').contentWindow;
}
export function getDoc() {
  if (testspa)
    return testspa.getDoc();

  //webhare compatibility - remove if we can migrate webhare to iframetestrunner
  return top.document.querySelector('#testframeholder iframe').contentDocument;
}

export function fill(element, newvalue) {
  element = _resolveToSingleElement(element);
  _getFocusableElement(element).focus();
  dompack.changeValue(element, newvalue);
}

export function addTests(tests) {
  if (running)
    throw new Error("Tests already started - too late to register new tests");

  let nexttestname = 'unnamed test';
  let testcount = tests.length;

  for (const test of tests) {
    if (typeof test === 'string') {
      nexttestname = test;
      testcount = 0;
      continue;
    }

    const testname = nexttestname + (testcount ? ` #${testcount}` : '');
    testlist.push({ name: testname, test: test });
    ++testcount;
  }

  if (!scheduledruntests) {
    scheduledruntests = true;
    dompack.onDomReady(runTests);
  }
}

export async function load(url) {
  //The test requires a page, so load it
  testspa.setCurrentWait("Wait: pageload");
  await testspa.loadTestFrame(url);
  testspa.setCurrentWait("");
}

export async function loadPage(url) {
  console.warn("loadPage is deprecated. replace with load"); //for compat with current webhare conventions
  return await load(url);
}


//wait for the UI to be free
export async function waitUIFree() {
  return await dombusy.waitUIFree();
}

function testWaitUntil(func, defer) {
  try {
    const res = func();
    if (res) //if truthy
      defer.resolve(res);
    else
      requestAnimationFrame(() => testWaitUntil(func, defer));
  } catch (e) {
    defer.reject(e);
  }
}

/** Return a promise that waits for event 'eventtype' to trigger on the node */
export function waitForEvent(node, eventtype, options) {
  return new Promise((resolve, reject) => {
    //we need access to the eventhandler after declaring, so it must be VAR
    const eventhandler = event => {
      if (options && options.filter && !options.filter(event))
        return;

      if (options && options.stop)
        dompack.stop(event);

      node.removeEventListener(eventtype, eventhandler, options && options.capture);
      resolve(event);
    };
    node.addEventListener(eventtype, eventhandler, options && options.capture);
  });
}

async function executeWaitTick() {
  //TODO setImmediate and mutationObserver, if available, are supposedly more accurate? https://github.com/medikoo/next-tick thinks so..
  return await new Promise(resolve => setTimeout(resolve, 1));
}

async function executeWaitFunction(func) {
  const deadline = Date.now() + 30000;
  while (true) {
    if (func())
      return;
    if (Date.now() > deadline)
      throw new Error("Wait timeout");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function executeWait(waittype) {
  if (typeof waittype === "function") {
    testspa.setCurrentWait("Wait: function");
    await executeWaitFunction(waittype);
  } else {
    testspa.setCurrentWait("Wait: " + waittype);
    switch (waittype) {
      case "tick":
        return await executeWaitTick();

      default:
        throw new Error(`Unsupported wait type '${waittype}'. Supported: 'tick'`);
    }
  }

  testspa.setCurrentWait("");
}
