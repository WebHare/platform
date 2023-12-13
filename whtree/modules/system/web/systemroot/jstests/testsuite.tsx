/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { qS, qSA } from 'dompack';
import * as dombusy from '@webhare/dompack/impl/busy';
import * as browser from 'dompack/extra/browser';
import * as domfocus from "dompack/browserfix/focus";
import { reportException, waitForReports } from "@mod-system/js/wh/errorreporting";
import "./testsuite.css";
import * as testservice from "./testservice.rpc.json";
import StackTrace from "stacktrace-js";
import { DeferredPromise } from '@mod-system/js/types';

const sourceCache = {};
const testframetabname = 'testframe' + Math.random();

if (window.Error && window.Error.stackTraceLimit)
  Error.stackTraceLimit = 50;

function getTestRoots() {
  const iframe = document.querySelector<HTMLIFrameElement>("#testframeholder iframe");
  if (!iframe)
    throw new Error("No <iframe> in testframeholder");
  const cw = iframe.contentWindow;
  if (!cw)
    throw new Error("No contentwindow in iframe found");

  return { win: cw, doc: cw.document, html: cw.document.documentElement, body: cw.document.body };
}

//Find best location to highlight, skipping internal files
function findBestStackLocation(stacktrace) {
  const filtered = stacktrace.filter(({ filename }) =>
    !filename.endsWith("/ap.js") &&
    !filename.endsWith("/ap.mjs") &&
    !filename.endsWith("/testframework.ts") &&
    !filename.endsWith("/testframework-rte.ts") &&
    !filename.endsWith("/checks.ts") &&
    !filename.includes("/dompack/testframework/") &&
    !filename.endsWith("/testsuite.tsx"));

  return filtered[0] || null;
}

class TestFramework {
  currentscript = '';
  tests = [];

  testframes = [];
  currenttestframe = "main";

  autoadvancetest = true;
  reportid = '';
  sessionid = '';

  wait4setuptests = null;
  loadtimeout = 90000;
  waittimeout = 60000;

  framecallwrapper = null;
  lastlognodes = [];
  delayafter = 0;
  pendingwaits = [];

  nextstepscheduled = false;

  lastbusycount = 0;

  stop = false;
  stoppromise = null;

  pagetitle: string;

  scheduledlogs = [];
  scheduledlogscb = null;

  waitstack = [];

  constructor() {
    this.pagetitle = document.title;

    if (window.__testframework)
      return console.error("Multiple testframeworks registered. Only one instance of a TestFramework may be created");
    if (window.parent && window.parent.__testframework)
      return console.error("Recursive testframework detected");
    window.__testframework = this;

    this.stoppromise = dompack.createDeferred();

    const params = new URL(location.href).searchParams;
    if (params.get("waittimeout"))
      this.waittimeout = parseInt(params.get("waittimeout"));

    document.getElementById('stoptests').addEventListener('click', function (e) { this.stop = true; this.stoppromise.reject(Error("test was cancelled")); e.target.disabled = "disabled"; }.bind(this));
    qS('#logmoreinfo').addEventListener('click', () => document.documentElement.classList.add('testframework--showfullerror'));
    qS('#testframetabs').addEventListener(`click`, evt => {
      if (evt.target.classList.contains("testframetab")) {
        this.currenttestframe = evt.target.dataset.name;
        this.rebuildFrameTabs();
      }
    });

    //for debugging, offer access to 'test' and 'testfw' in the main frame
    window.testfw = this;
  }
  haveDevtoolsUplink() {
    return Boolean(this.reportid);
  }
  setStatus(text) {
    if (dompack.debugflags.testfw)
      console.log("[testfw] status: " + text);
    document.getElementById('teststatus').textContent = text;

    document.title = this.pagetitle + ": " + text;
  }
  addTests(tests) {
    this.tests = this.tests.concat(tests);
  }
  runTests() {
    document.documentElement.classList.add("testframework--testsstarted");
    return this.runAllTests(0); // with promises
    //this.startNextTest(); // with old implementation
  }
  skipTest() {
    this.runAllTests(this.currenttest + 1);
  }
  getFrameRecord(name, { allowmissing } = {}) {
    name = name ?? this.currenttestframe;
    const rec = this.testframes.find(r => r.name == name);
    if (!rec && !allowmissing)
      throw new Error(`No such testframe with name ${JSON.stringify(name)}`);
    return rec;
  }
  resetPageFrame() {
    const rec = this.getFrameRecord();
    rec.win = null;
    rec.doc = null;
    dompack.empty(rec.holder);
  }
  rebuildFrameTabs() {
    const tabsnode = document.getElementById("testframetabs");
    dompack.empty(tabsnode);
    for (const f of this.testframes) {
      tabsnode.append(<div data-name={f.name} class={["testframetab", ...f.name == this.currenttestframe ? ["testframetab--selected"] : []]}>{f.name}</div>);
      f.holder && f.holder.classList.toggle("testframeholder--selected", f.name == this.currenttestframe);
      if (f.name == this.currenttestframe)
        f.holder.setAttribute("id", "testframeholder");
      else
        f.holder.removeAttribute("id");
    }
    tabsnode.style.display = this.testframes.length > 1 ? "block" : "none";
  }
  resetTest() {
    this.testframes = [];
    dompack.empty(document.getElementById("testframes"));
    this._setFrame("main", "add", { select: true });
    this.rebuildFrameTabs();

    // Reset test & output iframes
    this.scriptframe = null;
    this.scriptframewin = null;
    this.scriptframedoc = null;
  }



  /// Constuct an error with a fixed stack trace
  constructErrorWithTrace(errormsg) {
    try {
      throw new Error(errormsg);
    } catch (e) {
      return e;
    }
  }

  throwWaitError(deferred) {
    deferred.reject(this.waitstack[this.waitstack.length - 1]);
  }

  removeFromWaitStack(e) {
    const i = this.waitstack.indexOf(e);
    if (i !== -1)
      this.waitstack.splice(i, 1);
  }

  /// Rejects the deferred promise with a message on a timeout
  timedReject(deferred, msg, timeout) {
    const err = this.constructErrorWithTrace(msg + ", waited for " + timeout + "ms");
    this.waitstack.push(err);
    setTimeout(() => this.throwWaitError(deferred), timeout);
    deferred.promise.then(() => this.removeFromWaitStack(err), () => this.removeFromWaitStack(err));
  }

  async sendDevtoolsRequest(request: unknown) {
    return await testservice.syncDevToolsRequest(this.reportid, request);
  }

  /// Sends a report with the current progress
  async sendReport(finished) {
    // ensure the console logs are flushed
    if (finished)
      this._sendSeleniumLogs();

    if (!this.reportid)
      return;

    const result = { id: this.reportid, tests: [], finished: finished };
    result.tests = this.tests.map(test =>
    ({
      name: test.name,
      finished: test.finished || false,
      runsteps: test.runsteps || [],
      fails: test.fails || [],
      xfails: test.xfails || [],
      assetpacks: test.assetpacks || []
    }));

    // Wait for running errorreports to resolve locations
    const reportswaitpromise = waitForReports();
    if (reportswaitpromise) {
      console.log(`Waiting for crash reporting to finish`);
      await reportswaitpromise;
      console.log(`Crash reporting has finished, submitting report`);
    } else
      console.log(`Submitting ${finished ? "final" : "partial"} report`);

    await testservice.submitReport(this.reportid, result);
    if (finished && window.location.href.match(/autotests=close/)) {
      // Close the current window (from http://productforums.google.com/forum/#!topic/chrome/GjsCrvPYGlA)
      window.open('', '_self', '');
      window.close();
    }
    if (dompack.debugflags.testfw) {
      console.log('[testfw] REPORT', result);
    }
  }

  /** Schedules running of all tests
  */
  async runAllTests(startposition) {
    this.currenttest = startposition - 1;
    this.stop = false;
    this.stoppromise = dompack.createDeferred();
    document.getElementById('stoptests').disabled = false;
    document.getElementById('skiptest').disabled = true;

    // Send progress every 10 seconds
    const interval = setInterval(() => this.sendReport(false), 10000);

    try {
      // Sequentially run all tests
      for (let idx = startposition; idx < this.tests.length; ++idx)
        await this.runTest(idx);

      await this.cleanupAfterAllTests();
    } catch (e) {
      if (!e.testsuite_reported) {
        console.error('Running tests failed: ', e);
        reportException(e);
      }
    } finally {
      // Stop periodic reporting
      clearInterval(interval);
    }
  }

  cleanupAfterAllTests() {
    if (this.stop)
      return;

    if (this.tests.length > 1) //Note - we DONT reset the test if we were only running one specific test, as that's annoying for test builders
      this.resetTest();
    this.setStatus("All tests completed");
    if (this.reportid)
      this.sendReport(true);
  }

  /// Run a specific test
  async runTest(testnr) {
    if (this.stop)
      return;

    // Cleanup test state
    this.currenttest = testnr;
    this.currentstep = -1;
    this.currentsteps = null;

    // Get test, set expected args
    const test = this.tests[this.currenttest];
    this.args = test.args || [];

    // Unmark finished, just in case
    test.finished = false;

    // Send off a report, just in case we crash.
    this.sendReport(false);

    // Reset the test, signal loading state
    this.resetTest();
    this.setStatus(test.name + " loading");

    // Schedule test script load & test steps
    let result = this.loadTestIframe()
      .then(this.waitForTestSetup.bind(this))
      .catch(this.handleTestStepException.bind(this, test, { name: 'Loading test script', _rethrow: true }))
      .then(this.runAllTestSteps.bind(this));

    // Mark test as finished.
    result = result.finally(function () { test.finished = true; });

    // If we're in report mode, swallow any errors from loading the iframe / test registration
    if (this.reportid)
      result = result.catch(function (e) { console.error('Swallowed exception', e); });

    return result;
  }

  /** Loads the iframe with the test source
  */
  loadTestIframe() {
    const deferred = dompack.createDeferred();

    const test = this.tests[this.currenttest];

    const node_teststatus = document.querySelector(`#tests [data-testname="${test.name}"] .teststatus`);
    node_teststatus.textContent = "loading...";
    node_teststatus.scrollIntoView({ block: "nearest" });

    this.wait4setuptests = dompack.createDeferred();

    // Create a script - THEN add events. Might fail if not done in this order
    // No removing of events, this iframe will be thrown away on the next test
    const testurl = new URL(test.url);
    const whdebug = new URL(location.href).searchParams.get("wh-testscript-debug") ?? new URL(location.href).searchParams.get("wh-debug");
    if (whdebug !== null)
      testurl.searchParams.set("wh-debug", whdebug);

    this.scriptframe = dompack.create("iframe", { src: testurl.toString() });
    this.scriptframe.addEventListener("load", deferred.resolve);
    this.scriptframe.addEventListener("error", deferred.reject);
    document.getElementById('testscriptholder').appendChild(this.scriptframe);

    // Set timeout
    this.timedReject(deferred, "Timeout waiting for test page " + test.url, this.loadtimeout);

    // Schedule processing of the loaded iframe after the load event
    return deferred.promise.then(this.processTestIframe.bind(this));
  }

  /** Iframe with tests is loaded, calculate and store its doc & win
  */
  processTestIframe() {
    this.scriptframedoc = this.scriptframe.contentDocument;
    this.scriptframewin = this.scriptframe.contentWindow;

    if (!this.scriptframedoc || !this.scriptframewin)
      throw new Error("Unable to retrieve scriptframe window/document");

    this._recordAssetpacks(this.scriptframewin);
  }

  /// Waits for the test iframe js code to register its tests.
  waitForTestSetup() {
    // 1 minute should be enough. If the setup is earlier, their resolve will win (called from runTestSteps)
    this.timedReject(this.wait4setuptests, "Timeout waiting for test setup", 60000);
    return this.wait4setuptests.promise;
  }

  /// Runs all the test steps
  async runAllTestSteps() {
    const test = this.tests[this.currenttest];

    if (this.stop)
      return;

    // Schedule all steps sequentially
    for (let idx = 0; idx < this.currentsteps.length; ++idx)
      await this.runTestStep(this.currentsteps[idx], idx);

    // Schedule a state update after all tests are done
    if (this.stop)
      return;

    // Set this.currentstep to one past the last step - triggers 'done' texts in uodateTestState. Looks nice.
    this.currentstep = this.currentsteps.length;
    this.setStatus(test.name + " " + this.currentsteps.length + "/" + this.currentsteps.length);
    this.updateTestState();
  }

  /// Run a single test step
  runTestStep(step, idx) {
    this.currentstep = idx;
    this.lastbusycount = dombusy.getUIBusyCounter();

    console.log("[testfw] test:" + this.getCurrentStepName() + ", busycount = " + this.lastbusycount);
    const test = this.tests[this.currenttest];

    if (this.stop)
      return;

    // Translate legacy waits to modern format
    this.translateWaits(step);

    // Update the test state for this step, so the user knows we're running it.
    this.setStatus(test.name + " " + this.currentstep + "/" + this.currentsteps.length + (step.name ? ': ' + step.name : ''));
    this.updateTestState();

    // Result promise (chained with all the step parts)
    let result = Promise.resolve();

    if (step.ignore)
      return result;

    if (this.scriptframewin.Error && this.scriptframewin.Error.stackTraceLimit)
      this.scriptframewin.Error.stackTraceLimit = 50;

    // Signals to detect if a page load happens (all properties are promises)
    this.getFrameRecord().currentsignals = { pageload: null };

    // Loadpage? Execute it first
    if (step.loadpage)
      result = result.then(this.doLoadPage.bind(this, step));

    // Initialize the signals - AFTER loading the page.
    result = result.then(function () {
      // Modify signals, don't re-assign! We want to modify the object bound to executeWait.
      this.getFrameRecord().currentsignals.pageload = this.waitForPageFrameLoad(this.getFrameRecord(), { timeout: -1 }); // no timeout

      // Install errorlimits
      for (const f of this.testframes) {
        try {
          f.win.Error.stackTraceLimit = 50;
        } catch (e) {
          console.warn(`Could not set onerror handler in frame ${JSON.stringify(f.name)} due to the following exception: `, e);
        }
      }
    }.bind(this));

    // Test or wait? Execute it after the loadpage
    if (step.test || step.wait)
      result = result.then(() => this.executeStepTestFunction(step, idx));
    else if (step.email)
      result = result.then(this.executeStepEmail.bind(this, step, idx));

    // Schedule all waits serially after the tests. Clears signals if it uses them
    if (step.waits)
      step.waits.forEach(function (item) { result = result.then(this.executeWait.bind(this, step, item, this.getFrameRecord().currentsignals)); }.bind(this));

    // After the waits have all executed, see if a page load happened we did'nt expect
    result = result.then(() => {
      // A 'pageload' wait clears signals.pageload. If not cleared, error out when the load happens
      for (const f of this.testframes)
        if (f.currentsignals.pageload) {
          var err = new Error(`Page load happened in frame ${f.name} but was not expected`);
          const errorfunc = function () { throw err; };
          // FIXME: test if this really works. As far as I read the specs, if signals.pageload is already resolved/rejected
          // it should win the race, ignoring the second Promise.resolve().
          return Promise.race([f.currentsignals.pageload.then(errorfunc, errorfunc), Promise.resolve()]);
        }
    });

    // If marked as xfail, give an error when no exception, and swallow exceptions (but note them & update state)
    if (step.xfail) {
      result = result.then(
        function () { throw new Error("Step " + idx + " should have failed, but didn't (is marked as xfail)"); },
        function () {
          // Note & swallow the execution
          test.xfails = test.xfails || [];
          test.xfails.push({ stepname: step.name || '', stepnr: idx, text: step.xfail, e: 'Failed as expected' });
          this.updateTestState();
        }.bind(this));
    }

    result = result.finally(function () {
      //        for (const f of this.testframes)
      //          f.currentsignals = null;
      test.runsteps = test.runsteps || [];
      test.runsteps.push({ stepname: step.name || '', stepnr: idx });
    });

    // Handle success / exceptions of the test
    result = result.then(
      this.handleTestStepSuccess.bind(this, test, step),
      this.handleTestStepException.bind(this, test, step));

    return result;
  }

  /// Handles a succesfully completed step
  handleTestStepSuccess(test, step) {
    // Success: remove all log nodes, not interesting
    for (let i = 0; i < this.lastlognodes.length; ++i)
      if (this.lastlognodes[i].parentNode)
        this.lastlognodes[i].parentNode.removeChild(this.lastlognodes[i]);
    this.lastlognodes = [];
  }

  /// Handles a test step that errored out
  async handleTestStepException(test, step, e) {
    const fullname = step.name ? step.name + (step.subname ? "#" + step.subname : "") : "";
    // Got a test exception. Log it everywhere
    const prefix = 'Test ' + test.name + ' step ' + (fullname ? fullname + ' (#' + this.currentstep + ')' : '#' + this.currentstep);
    const text = prefix + ' failed';

    console.warn(text);
    console.warn(e);

    this.haveerror = true;

    this.log(prefix + (e ? " exception: " + e : " failed with unknown reason"));
    const lognode = this.log("Location: computing...");

    test.fails = (test.fails || []);
    const failrecord = { stepname: fullname, stepnr: this.currentstep, text: text, e: String(e || ''), stack: (e && e.stack) || "", lognode };
    test.fails.push(failrecord);
    this.updateTestState();
    this.lastlognodes = [];

    e.testsuite_reported = true;
    // force the resolve, so we can use the stack trace for location resolving
    const res = reportException(e,
      {
        extradata:
        {
          __wh_jstestinfo:
          {
            reportid: this.reportid,
            testname: test.name,
            testlisturl: this.testlisturl || ""
          }
        },
        serviceuri: "/wh_services/system/jstests",
        servicefunction: 'ReportJSError',
        forceresolve: true
      });

    document.getElementById('skiptest').removeAttribute('disabled');

    res.then(({ stacktrace }) => {
      console.log("Got stack trace:", stacktrace);

      const fullerrornode = qS('#fullerror');
      dompack.empty(fullerrornode);
      stacktrace.forEach(el => {
        dompack.append(fullerrornode, `${el.filename}:${el.line}:${el.col}`, dompack.create('br'));
      });
      document.documentElement.classList.add('testframework--havefullerror');

      const bestlocation = findBestStackLocation(stacktrace);
      if (bestlocation) {
        lognode.textContent = `Location: ${bestlocation.filename}:${bestlocation.line}:${bestlocation.col}`;
        this.updateTestState();
      }
    });

    if (this.currentwaitstack) {
      let stackframes = await StackTrace.fromError(this.currentwaitstack, { sourceCache });
      stackframes = stackframes.map(frame => (
        {
          line: frame.lineNumber,
          func: frame.functionName,
          filename: frame.fileName,
          col: frame.columnNumber
        }));

      stackframes.forEach(el => {
        console.log(`${el.filename}:${el.line}:${el.col}`);
      });

      const bestlocation = findBestStackLocation(stackframes);
      if (bestlocation)
        console.warn(`Wait location: ${bestlocation.filename}:${bestlocation.line}:${bestlocation.col}`);
    }

    // Swallow exception if in reportid mode unless running just one test (ADDME: abort the current test and move to the next test in reportid mode, but never run further steps)
    if (!this.reportid || step._rethrow || this.tests.length == 1)
      throw e;
  }

  /// Execute a load page command
  doLoadPage(step) {
    let loadpage;
    if (typeof step.loadpage == 'string')
      loadpage = step.loadpage;
    else if (typeof step.loadpage == 'function') {
      const framerec = this.getFrameRecord();
      loadpage = step.loadpage(framerec.doc, framerec.win);
    }

    if (dompack.debugflags.testfw)
      console.log('[testfw] doLoadPage: ' + loadpage);

    this.resetPageFrame();
    const framerec = this.getFrameRecord();

    const name = framerec.name == "main" ? "testframe" : `testframe-${framerec.name}`;
    framerec.iframe = dompack.create("iframe", { "id": name, "name": name });
    framerec.holder.appendChild(framerec.iframe);
    framerec.iframe.src = loadpage;
    if (framerec.holder.dataset.width)
      framerec.iframe.style.width = `${framerec.holder.dataset.width}px`;

    document.getElementById('currentwait').textContent = "Wait: pageload";
    document.getElementById('currentwait').style.display = "inline-block";

    return this.waitForPageFrameLoad(framerec).finally(function () {
      document.getElementById('currentwait').style.display = "none";
    });
  }

  /** Returns a promise that is fulfilled when the testframe iframe (re-)loads
      @param options
      @cell(boolean) options.timeout Timeout override
  */
  waitForPageFrameLoad(framerec, options) {
    //var iframe = this.getFrameRecord().iframe;
    const deferred = dompack.createDeferred();
    if (!framerec.iframe)
      return deferred.promise;

    if (!options || !options.timeout || options.timeout >= 0)
      this.timedReject(deferred, "Timeout waiting for test frame to load", (options || {}).timeout || this.loadtimeout);

    // Split setting events from event creation
    framerec.iframe.addEventListener("load", deferred.resolve);
    framerec.iframe.addEventListener("error", deferred.reject);

    // Remove both load/error events when receiving one of them
    deferred.promise.finally(() => {
      framerec.iframe.removeEventListener("load", deferred.resolve);
      framerec.iframe.removeEventListener("error", deferred.reject);
    });

    // When the iframe has loaded, process it to get the doc & window. Just error out when loading failed.
    return deferred.promise.then(this.processLoadedTestFrame.bind(this, framerec, options));
  }

  canAccessTestframe() {
    try {
      const framerec = this.getFrameRecord();
      framerec.win.document;
      return true;
    } catch (ignore) {
      return false;
    }
  }

  /// Get & store the win.doc from the pageframe
  processLoadedTestFrame(framerec, options) {
    framerec.doc = framerec.iframe.contentDocument;
    framerec.win = framerec.iframe.contentWindow;
    if (dompack.debugflags.testfw)
      console.log('[testfw] loaded page: ' + framerec.win.location.href);

    if (!this.canAccessTestframe())
      return;

    this._recordAssetpacks(framerec.win);

    const focusable = domfocus.getFocusableComponents(framerec.doc.documentElement);
    for (let i = 0; i < focusable.length; ++i) {
      if (focusable[i].autofocus) {
        focusable[i].focus();
        break;
      }
    }
    try {
      const doctitle = framerec.doc.title;
      if (doctitle == '404 Not found')
        throw new Error("The child frame returned a 404 error, please check the url");
    } catch (e) {
      throw new Error("Exception accessing child frame, assuming security error" + e);
    }

    if (framerec.win.Promise && Promise.__disabletrycatch)
      framerec.win.Promise.__disabletrycatch = Promise.__disabletrycatch;
  }

  _setSubName(step, name) {
    if (dompack.debugflags.testfw)
      console.log('[testfw] -- setsubname ', name);
    step.subtest = (step.subtest || 0) + 1;
    step.subname = name;
  }

  _checkClientAsyncFunc() {
    if (this.activeasyncerr) {
      const e = this.activeasyncerr;
      this.activeasyncerr = null;
      throw e;
    }
  }

  _checkClientAsync(promise) {
    this._checkClientAsyncFunc();
    this.activeasyncerr = new Error("This async function was not used with await!");
    return promise.finally(() => this.activeasyncerr = null);
  }

  async _setFrame(name, action, { width } = {}) {
    const rec = this.getFrameRecord(name, { allowmissing: true });
    switch (action) {
      case "add":
        {
          if (rec)
            throw new Error(`A frame with the name ${JSON.stringify(name)} already exists`);
          const holder = <div class="testframeholder" data-name={name}></div>;
          holder.dataset.width = width || "";
          const currentsignals = {};
          this.testframes.push({ name, holder, currentsignals });
          document.getElementById("testframes").append(holder);
          this.currenttestframe = name;
          this.rebuildFrameTabs();
          await this.doLoadPage({ loadpage: "about:blank" }, null);
          currentsignals.pageload = this.waitForPageFrameLoad(this.getFrameRecord(), { timeout: -1 }); // no timeout
        } break;
      case "update":
        {
          if (!rec)
            throw new Error(`No frame with the name ${JSON.stringify(name)} exists`);
          if (width !== undefined) {
            rec.holder.dataset.width = width || "";
            rec.iframe && (rec.iframe.style.width = width ? `${width}px` : `auto`);
          }
        } break;
      case "delete":
        {
          if (name == "main")
            throw new Error(`Cannot delete main test iframe`);
          rec.holder.remove();
          this.testframes = this.testframes.filter(f => f.name != name);
          if (this.currenttestframe == name)
            this.currenttestframe = this.testframes[0].name;
        } break;
      case "select":
        {
          this.currenttestframe = name;
        } break;
      default:
        {
          throw new Error(`Unknown frame action ${action}`);
        }
    }

    this.rebuildFrameTabs();
  }

  setCallbacks(step) {
    if (!this.setcallbacksfunc)
      return;
    if (step)
      this.setcallbacksfunc(
        {
          executeWait: item => this._checkClientAsync(this.executeWait(step, item, this.getFrameRecord().currentsignals)),
          subtest: name => this._setSubName(step, name),
          setFrame: (name, type, options) => this._checkClientAsync(this._setFrame(name, type, options))
        });
    else {
      this._checkClientAsyncFunc();
      this.setcallbacksfunc(
        {
          executeWait: () => { throw new Error("calling test.wait outside test function"); },
          subtest: () => { throw new Error("calling test.subtest outside test function"); }
        });
    }
  }

  /// Executes the step.test or test.wait functions
  executeStepTestFunction(step) {
    const deferred = dompack.createDeferred();

    const func = step.test || step.wait;

    // Initialize the callback for step.wait if needed
    let callback;
    if (step.wait)
      callback = deferred.resolve;

    let returnvalue;

    this.setCallbacks(step);

    const framerec = this.getFrameRecord();
    returnvalue = func(framerec.doc, framerec.win, callback);

    //this.uiwasbusy = this.pageframewin && this.pageframewin.$wh && this.pageframewin.$wh.busycount > 0;
    if (step.wait || (returnvalue && returnvalue.then)) {
      const text = "Wait: " + (step.wait ? "callback" : "test promise");
      document.getElementById('currentwait').textContent = text;
      document.getElementById('currentwait').style.display = "inline-block";
      deferred.promise = deferred.promise.finally(function () { document.getElementById('currentwait').style.display = "none"; });
    }

    if (step.test) {
      // Resolve deferred with the returnvalue of the test function. If a promise was returned, deferred will be fulfulled
      // with the result of the promise
      Promise.resolve(returnvalue)
        .finally(() => this.setCallbacks(null))
        .then(deferred.resolve, deferred.reject);

      // Also schedule a timeout
      this.timedReject(deferred, "Timeout waiting for promise returned by step.test to resolve", step.timeout || this.waittimeout);
    } else // Timeout on the callback, please. If the callback is earlier, it wins.
    {
      this.timedReject(deferred, "Timeout waiting for step.wait callback", step.timeout || this.waittimeout);
    }

    return deferred.promise;
  }

  /// Calls a wait functions, if it fails, request a re-test on the next animation frame
  repeatedFunctionTestIterate(func, deferred) {
    this.animationframerequest = 0;
    try {
      const result = func();
      if (!result) {
        this.animationframerequest = requestAnimationFrame(() => this.repeatedFunctionTestIterate(func, deferred));
      } else {
        deferred.resolve(result);
      }
    } catch (e) {
      // func() threw. Not nice, report back.
      deferred.reject(e);
    }
  }

  repeatedFunctionTest(step, func) {
    const deferred = dompack.createDeferred();

    // When the test is cancelled, resolve the wait promise immediately
    this.stoppromise.promise.then(deferred.resolve, deferred.reject);

    // Schedule a timeout
    this.timedReject(deferred, "Timeout when waiting for function", step.timeout || this.waittimeout);

    // If the timeout triggers, cancel the animationframerequest
    deferred.promise.catch(function () {
      if (this.animationframerequest)
        cancelAnimationFrame(this.animationframerequest);
      this.animationframerequest = 0;
    }.bind(this));

    // Start the first iteration
    this.repeatedFunctionTestIterate(func, deferred);
    return deferred.promise;
  }

  /** Executes a wait from a steps 'waits' array
      @param item
      @param signals
      @cell signals.pageload Promise fulfilled or rejected when page loads
  */
  async executeWait(step, item, signals) {
    if (Array.isArray(item))
      throw new Error(`executeWait incorrectly invoked with array`);
    const text = "Wait: " + (typeof item == "function" ? "function" : item);
    this.currentwaitstack = new Error;
    document.getElementById('currentwait').textContent = text;
    document.getElementById('currentwait').style.display = "inline-block";

    if (dompack.debugflags.bus)
      console.log("[bus] Start wait for '" + item + "'");

    // Type == function: execute function on every animation frame until it succeeds
    if (typeof item == "function") {
      // function in waits has signature func(doc, win)
      const framerec = this.getFrameRecord();
      let promise = this.repeatedFunctionTest(step, item.bind(null, framerec.doc, framerec.win));
      if (dompack.debugflags.bus)
        promise = promise.then(x => { console.debug("Finished wait for '" + item + "'"); this.currentwaitstack = null; return x; });
      return promise.finally(this.executeWaitFinish.bind(this));
    }

    const deferred = dompack.createDeferred();
    if (dompack.debugflags.bus)
      deferred.promise = deferred.promise.then(function (x) { console.debug("Finished wait for '" + item + "'"); return x; });

    // When the test is cancelled, resolve the wait promise immediately
    this.stoppromise.promise.then(deferred.resolve, deferred.reject);

    if (item == "events" || item == "tick") {
      console.warn(`Waiting for '${item}' just waits for 1 millisecond and does nothing magic, so just replace it with await wait(1)`);
      item = 1;
    }

    // Number: just wait for so many milliseconds
    if (typeof item == "number") {
      setTimeout(deferred.resolve, item);
      deferred.promise.then(() => this.currentwaitstack = null);
      return deferred.promise.finally(this.executeWaitFinish.bind(this));
    }

    switch (item) {
      case "ui":
      case "ui-nocheck":
        {
          if (item == 'ui' && this.lastbusycount == dombusy.getUIBusyCounter())
            throw new Error("'ui' wait requested but it was never busy since the test started, busycount = " + dombusy.getUIBusyCounter());

          dombusy.waitUIFree().then(deferred.resolve);
          deferred.promise.then(() => this.currentwaitstack = null);
          this.timedReject(deferred, "Timeout when waiting for UI", step.timeout || this.waittimeout);
        } break;

      case "pointer":
        {
          if (!this.scriptframewin.waitForGestures)
            throw Error("waitforgestures specified, but no waitForGestures found in scriptframe");

          this.scriptframewin.waitForGestures(deferred.resolve);
          deferred.promise.then(() => this.currentwaitstack = null);
          this.timedReject(deferred, "Timeout when waiting for gestures to finish", step.timeout || this.waittimeout);
        } break;

      case "animationframe":
        {
          const framerec = this.getFrameRecord();
          if (!framerec.win.requestAnimationFrame)
            throw new Error("waitforanimationframe specified, but no requestAnimationFrame found in scriptframe");
          framerec.win.requestAnimationFrame(deferred.resolve);
          deferred.promise.then(() => this.currentwaitstack = null);
          this.timedReject(deferred, "Timeout when waiting for animation frame", step.timeout || this.waittimeout);
        } break;

      case "load":
      case "pageload":
        {
          if (!signals.pageload)
            throw new Error("Pageload promise was already used in earlier wait");

          this.timedReject(deferred, "Timeout when waiting for pageload", step.timeout || this.waittimeout);

          const framerec = this.getFrameRecord();
          const promise = signals.pageload;
          signals.pageload = null;
          try {
            const result = await Promise.race([promise, deferred.promise]);
            this.currentwaitstack = null;
            return result;
          } finally {
            signals.pageload = this.waitForPageFrameLoad(framerec, { timeout: -1 }); // no timeout
            this.executeWaitFinish();
          }
        }
      case "scroll":
        {
          const win = this.getFrameRecord().win;
          var scrollwaiter = function () {
            //this event will fire on scroll, and then schedule a delay() to allow other scroll handlers to run
            setTimeout(deferred.resolve, 0);
            this.currentwaitstack = null;
            win.removeEventListener("scroll", scrollwaiter);
          }.bind(this);
          win.addEventListener("scroll", scrollwaiter);
          this.timedReject(deferred, "Timeout when waiting for scroll event", step.timeout || this.waittimeout);
        } break;

      default:
        {
          throw new Error("Unimplemented wait type '" + item + "'");
        }
    }

    return deferred.promise.finally(this.executeWaitFinish.bind(this));
  }

  executeWaitFinish() {
    document.getElementById('currentwait').style.display = "none";
  }

  /// Translate the .waitxxx values in a test step to step.waits
  translateWaits(step) {
    const waits = step.waits || [];

    const translations =
    {
      waitforgestures: 'pointer',
      waitwhtransitions: 'ui',
      waitforanimationframe: 'animationframe'
    };

    Object.entries(translations, function ([name, value]) {
      if (step[name]) {
        console.error(name + " is deprecated, use waits:[\"" + value + "\"]");
        waits.push(value);
        delete step[name];
      }
    });

    if (step.expectload) {
      console.error('expectload is deprecated, use a normal test() and waits: ["pageload"]', step);
      step.test = step.expectload;
      delete step.expectload;
      waits.unshift('pageload');
    }

    if (step.waituntil) {
      console.error('waituntil is deprecated, use waits: [function (doc, win) { ... } ]', step);
      waits.unshift(step.waituntil);
      delete step.waituntil;
    }

    if (waits.length)
      step.waits = waits;
  }

  // Batch log entries every 100ms
  _scheduleSeleniumLog(method, args) {
    this.scheduledlogs.push({ method, args, time: Date.now() });
    if (!this.scheduledlogscb)
      this.scheduledlogscb = setTimeout(() => this._sendSeleniumLogs(), 100);
  }

  // send out all logs
  _sendSeleniumLogs() {
    this.scheduledlogscb = null;
    if (this.scheduledlogs.length) {
      testservice.JSTestLog([this.testfw.reportid, this.scheduledlogs]);
      this.scheduledlogs = [];
    }
  }

  // standardize stacks to 'funcname@http-location:line:col'
  _standardizeStack(stack, oneline) {
    const slicepoint = browser.getName() === "firefox" ? 2 : 3;
    const items = stack.split("\n").slice(slicepoint);
    return items.map(line => {
      line = line.replace("   at ", "");
      line = line.replace("   at ", "");
      line = line.replace(" (", "@");
      if (line.endsWith(")"))
        line = line.slice(0, -1);
      return line;
    }).join("\n");
  }

  _recordAssetpacks(wnd) {
    const test = this.tests[this.currenttest];
    const scripttags = wnd.document.getElementsByTagName("script");

    for (const tag of Array.from(scripttags)) {
      const match = tag.src.match(/\/.ap\/([^/]*)\/ap.js$/);
      if (match) {
        test.assetpacks = (test.assetpacks) || [];
        test.assetpacks.push(match[1]);
      }
    }
  }

  guaranteeTestNames(steps) {
    let lastname = 'unnamed test', lastcount = 0;
    for (const step of steps) {
      if (step.name) {
        lastname = step.name;
        lastcount = 1;
      } else {
        step.name = lastname + (lastcount ? " (" + ++lastcount + ")" : "");
      }
    }
  }

  runTestSteps(steps, setcallbacksfunc) {
    if (this.currentsteps)
      return console.error("Multiple teststeps received");
    this.setcallbacksfunc = setcallbacksfunc;

    this.currentsteps = steps;
    this.guaranteeTestNames(this.currentsteps);

    if (dompack.debugflags.testfw)
      console.log(`[testfw] ${steps.length} steps have been registered`);
    if (this.wait4setuptests.resolve)
      this.wait4setuptests.resolve();
    else
      this.wait4setuptests.donePreload(true);

    // Pass selenium data back to the test script
    return {
      testsession: document.body.getAttribute('data-testsession')
    };
  }

  log(text) {
    const nodes = [document.createTextNode(text), document.createElement("br")];
    this.lastlognodes.push(nodes[0]);
    this.lastlognodes.push(nodes[1]);

    document.getElementById('logholder').appendChild(nodes[0]);
    document.getElementById('logholder').appendChild(nodes[1]);
    return nodes[0];
  }

  updateTestState() {
    const test = this.tests[this.currenttest];
    if (!test) {
      console.error('no test found', this.currenttest, this.tests.length);
      console.trace();
    }
    const node_teststatus = document.querySelector(`#tests [data-testname="${test.name}"] .teststatus`);
    if (this.currentstep == -1) {
      node_teststatus.textContent = "test not loaded";
      Object.assign(node_teststatus.style, { 'font-weight': 'bold', 'color': '#FF0000' });
    } else {
      const stepname = (this.currentsteps[this.currentstep] || {}).name;
      const xfails = test.xfails ? ' (xfails: ' + test.xfails.map(function (v) { return v.stepnr + (v.stepname ? ': ' + v.stepname : ''); }).join(', ') + ')' : '';
      const fails = test.fails ? ' (fails: ' + test.fails.map(function (v) { return v.stepnr + (v.stepname ? ': ' + v.stepname : ''); }).join(', ') + ')' : '';

      let suffix = (stepname ? ': ' + stepname : '') + fails + xfails;
      if (!suffix && this.currentstep >= this.currentsteps.length)
        suffix += ' - done';

      node_teststatus.textContent = this.currentstep + "/" + this.currentsteps.length + suffix;
      if (fails)
        Object.assign(node_teststatus.style, { 'font-weight': 'bold', 'color': '#FF0000' });
      else
        Object.assign(node_teststatus.style, { 'font-weight': 'normal', 'color': '#000000' });
      node_teststatus.scrollIntoView({ block: "nearest" });
    }
  }

  startNextStep() {
    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    setTimeout(() => this.startNextStepNow(), 0);
  }
  doWaitOutDelay() {
    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    setTimeout(() => this.this.startNextStepNow(), this.delayafter);
    this.delayafter = 0;
  }
  doWaitForGestures() {
    this.waitforgestures = false;
    if (!this.scriptframewin.waitForGestures)
      throw new Error("waitforgestures specified, but no waitForGestures found in scriptframe");

    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    this.scriptframewin.waitForGestures(this.startNextStepNow.bind(this));
  }
  doWaitForAnimationFrame() {
    const framerec = this.getFrameRecord();
    this.waitforanimationframe = false;
    if (!framerec.win.requestAnimationFrame)
      throw new Error("waitforanimationframe specified, but no requestAnimationFrame found in scriptframe");

    framerec.win.requestAnimationFrame(this.startNextStepNow.bind(this));
  }

  getCurrentStep() {
    return this.currentsteps[this.currentstep];
  }

  getCurrentStepName() {
    return this.getCurrentStep().name;
  }
}

class TestSuite {
  constructor() {
    this.gottests = false;
    this.started = false;
    dompack.onDomReady(() => this.onDomReady());
  }

  onDomReady() {
    this.testfw = new TestFramework;

    const url = new URL(window.location.href);
    this.repeatuntilerror = url.searchParams.get('repeatuntilerror') == '1';
    this.autostart = url.searchParams.get('autostart') === '1';

    this.getTestList();

    document.getElementById('toggleautostart').addEventListener('click', () => this.toggleAutoStart());
    document.getElementById('togglerepeatuntilerror').addEventListener('click', () => this.toggleRepeatUntilError());
    document.getElementById('opentestframe').addEventListener("click", () => this.openTestFrame());
    document.getElementById('skiptest').addEventListener("click", () => this.skipTest());
    if (!this.autostart) {
      document.getElementById('toggleautostart').textContent = "Enable autostart";
      document.getElementById('starttests').addEventListener("click", event => {
        document.getElementById('starttests').disabled = true;
        event.target.blur();
        this.testlistpromise.then(() => this.startTests());
      });
    } else {
      document.getElementById('toggleautostart').textContent = "Disable autostart";
      document.getElementById('starttests').disabled = true;
    }
    if (this.repeatuntilerror)
      document.getElementById('togglerepeatuntilerror').textContent = "Disable repeatuntilerror";
    else
      document.getElementById('togglerepeatuntilerror').textContent = "Enable repeatuntilerror";
  }

  getTestList() {
    const url = new URL(location.href);
    const masks = (url.searchParams.get('mask') || "*").split(",");
    const skips = url.searchParams.get('skip') ? url.searchParams.get('skip').split(",") : [];

    let testlisturl = document.body.dataset.testslist;
    testlisturl = new URL(testlisturl, location.href);
    this.testlistpromise = fetch(testlisturl, { credentials: "same-origin" })
      .then(response => response.json()).then(list => {
        const filtered = [];

        list.forEach(item => {
          const li = dompack.create("li", { dataset: { testname: item.name } });
          const url = new URL(location.href);
          url.searchParams.set("skip", "");
          url.searchParams.set("autotests", "");
          url.searchParams.set("reportid", "");
          url.searchParams.set("startat", "");
          url.searchParams.delete("mask"); //we want it to be last for easier url editing, quick fix...
          url.searchParams.set("mask", item.name);

          item.url = new URL(item.url, testlisturl).toString();

          li.append(dompack.create("a", { href: url.toString(), textContent: item.name }), " ");

          if (item.tags.length)
            li.appendChild(dompack.create("span", { className: "tags", textContent: `(${item.tags.join(', ')}) ` }));

          li.appendChild(dompack.create("span", { className: "teststatus" }));

          document.getElementById("tests").appendChild(li);
          filtered.push(item);
        });

        this.testfw.reportid = url.searchParams.get('reportid');
        this.testfw.testlisturl = testlisturl;
        this.testfw.addTests(filtered);
        this.gottests = true;

        if (!url.searchParams.get('autostart'))
          this.autostart = qSA('#tests li').length == 1;

        if (this.autostart || this.repeatuntilerror)
          this.startTests();

      });
  }

  toggleAutoStart() {
    const url = new URL(window.location.href);
    url.searchParams.set('autostart', this.autostart ? '0' : '1');
    location.href = url.toString();
  }

  toggleRepeatUntilError() {
    const url = new URL(window.location.href);
    url.searchParams.set('repeatuntilerror', this.repeatuntilerror ? '0' : '1');
    location.href = url.toString();
  }

  startTests() {
    if (!this.gottests)
      this.autostart = true;
    else {
      if (this.started)
        return;
      this.started = true;

      this.testfw.runTests().then(() => this.checkTestResult());
    }
  }

  checkTestResult() {
    if (this.repeatuntilerror && !this.testfw.haveerror)
      window.location.reload();
  }

  skipTest() {
    this.testfw.skipTest();
  }

  onError(response) {
    console.error("Function invocation failed", response);
    alert("test runner failed\n" + response.error.message);
  }

  openTestFrame() {
    let href = null;
    try {
      href = getTestRoots().win.location.href;
    } catch (e) {
      console.log("getting location failed", e);
      href = document.getElementById('testframeholder').firstChild.src;
    }
    window.open(href, testframetabname);
  }
}

new TestSuite;
