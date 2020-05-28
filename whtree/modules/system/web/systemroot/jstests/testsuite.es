import * as dompack from 'dompack';
import { qS, qSA } from 'dompack';
import * as dombusy from 'dompack/src/busy';
import * as browser from 'dompack/extra/browser';
import * as domfocus from "dompack/browserfix/focus";
import { URL } from 'dompack/browserfix/url';
import { reportException, shouldIgnoreOnErrorCallback, waitForReports } from "@mod-system/js/wh/errorreporting";
import "./testsuite.css";
import minimatch from "minimatch";
import * as testservice from "./testservice.rpc.json";

let testframetabname = 'testframe' + Math.random();

if (window.Error && window.Error.stackTraceLimit)
  Error.stackTraceLimit = 50;

function getTestRoots()
{
  var iframe = document.querySelector("#testframeholder iframe");
  if(!iframe)
    throw new Error("No <iframe> in testframeholder");
  var cw = iframe.contentWindow;
  if(!cw)
    throw new Error("No contentwindow in iframe found");

  return { win: cw, doc: cw.document, html: cw.document.documentElement, body: cw.document.body };
}

class TestFramework
{
  constructor()
  {
    this.currentscript = '';
    this.tests = [];
    this.pageframedoc = null;
    this.pageframewin = null;
    this.scriptframe = null;
    this.autoadvancetest = true;
    this.catchexceptions = !window.location.href.match(/nocatch=1/);
    this.reportid = '';
    this.sessionid = '';

    this.wait4setuptests = null;
    this.loadtimeout = 90000;
    this.waittimeout = 60000;

    this.framecallwrapper = null;
    this.lastlognodes = [];
    this.delayafter = 0;
    this.pendingwaits = [];

    this.nextstepscheduled = false;

    this.lastbusycount = 0;

    this.stop = false;
    this.stoppromise = null;

    this.pagetitle = document.title;

    this.scheduledlogs = [];
    this.scheduledlogscb = null;

    if(window.__testframework)
      return console.error("Multiple testframeworks registered. Only one instance of a TestFramework may be created");
    if(window.parent && window.parent.__testframework)
      return console.error("Recursive testframework detected");
    window.__testframework = this;

    this.stoppromise = dompack.createDeferred();

    window.addEventListener("dompack:busymodal", evt =>
    {
      let roots = getTestRoots();
      evt.preventDefault();
      //simulate setting --busymodal on the subwindow
      if(roots.html && dompack.dispatchCustomEvent(roots.win, 'dompack:busymodal', { bubbles: true, cancelable: true, detail: evt.detail }))
        dompack.toggleClass(roots.html, 'dompack--busymodal', evt.detail.islock);
    });

    document.getElementById('stoptests').addEventListener('click', function(e) { this.stop = true; this.stoppromise.reject(Error("test was cancelled")); e.target.disabled = "disabled"; }.bind(this));
    qS('#logmoreinfo').addEventListener('click', () => document.documentElement.classList.add('testframework--showfullerror'));

    //for debugging, offer access to 'test' and 'testfw' in the main frame
    window.testfw = this;
  }
  haveDevtoolsUplink()
  {
    return !!this.reportid;
  }
  setStatus(text)
  {
    if(dompack.debugflags.testfw)
      console.log("[testfw] status: " + text);
    document.getElementById('teststatus').textContent = text;

    document.title = this.pagetitle + ": " + text;
  }
  addTests(tests)
  {
    this.tests = this.tests.concat(tests);
  }
  runTests()
  {
    document.documentElement.classList.add("testframework--testsstarted");
    this.runAllTests(0); // with promises
    //this.startNextTest(); // with old implementation
  }
  skipTest()
  {
    this.runAllTests(this.currenttest+1);
  }
  resetPageFrame()
  {
    this.pageframedoc=null;
    this.pageframewin=null;

    dompack.empty(document.getElementById('testframeholder'));
  }
  resetTest()
  {
    // Reset test & output iframes
    this.resetPageFrame();
    dompack.empty(document.getElementById('testscriptholder'));

    this.scriptframe = null;
    this.scriptframewin = null;
    this.scriptframedoc = null;
  }

  /// Returns a function that rejects the deferred promise with an Error, with the specified message
  bindDeferredWithError(deferred, errormsg)
  {
    let thrown_exception;
    try
    {
      throw new Error(errormsg);
    }
    catch (e)
    {
      thrown_exception = e;
    }

    return () => deferred.reject(thrown_exception);
  }

  /// Rejects the deferred promise with a message on a timeout
  timedReject(deferred, msg, timeout)
  {
    setTimeout(this.bindDeferredWithError(deferred, msg + ", waited for " + timeout + "ms"), timeout);
  }

  async sendDevtoolsRequest(request)
  {
    return await testservice.syncDevToolsRequest(this.reportid, request);
  }

  /// Sends a report with the current progress
  async sendReport(finished)
  {
    // ensure the console logs are flushed
    if (finished)
      this._sendSeleniumLogs();

    if (!this.reportid)
      return;

    var result = { id: this.reportid, tests: [], finished: finished };
    result.tests = this.tests.map(test =>
        ({ name: test.name
         , finished: test.finished||false
         , runsteps: test.runsteps || []
         , fails: test.fails || []
         , xfails: test.xfails || []
         , assetpacks: test.assetpacks || []
         }));

    // Wait for running errorreports to resolve locations
    const reportswaitpromise = waitForReports();
    if (reportswaitpromise)
    {
      console.log(`Waiting for crash reporting to finish`);
      await reportswaitpromise;
      console.log(`Crash reporting has finished, submitting report`);
    }
    else
      console.log(`Submitting ${finished ? "final" : "partial"} report`);

    await testservice.submitReport(this.reportid, result);
    if (finished && window.location.href.match(/autotests=close/))
    {
      // Close the current window (from http://productforums.google.com/forum/#!topic/chrome/GjsCrvPYGlA)
      window.open('', '_self', '');
      window.close();
    }
    if(dompack.debugflags.testfw)
    {
      console.log('[testfw] REPORT', result);
    }
  }

  /** Schedules running of all tests
  */
  async runAllTests(startposition)
  {
    this.currenttest = startposition-1;
    this.stop = false;
    this.stoppromise = dompack.createDeferred();
    document.getElementById('stoptests').disabled = false;
    document.getElementById('skiptest').disabled = true;

    // Send progress every 10 seconds
    let interval = setInterval(() => this.sendReport(false), 10000);

    try
    {
      // Sequentially run all tests
      for(let idx = startposition; idx < this.tests.length; ++idx)
        await this.runTest(idx);

      await this.cleanupAfterAllTests();
    }
    catch(e)
    {
      if (!e.testsuite_reported)
      {
        console.error('Running tests failed: ', e);
        reportException(e);
      }
    }
    finally
    {
      // Stop periodic reporting
      clearInterval(interval);
    }
  }

  cleanupAfterAllTests()
  {
    if (this.stop)
      return;

    if (this.tests.length > 1) //Note - we DONT reset the test if we were only running one specific test, as that's annoying for test builders
      this.resetTest();
    this.setStatus("All tests completed");
    if (this.reportid)
      this.sendReport(true);
  }

  /// Run a specific test
  async runTest(testnr)
  {
    if (this.stop)
      return;

    // Cleanup test state
    this.currenttest = testnr;
    this.currentstep = -1;
    this.currentsteps = null;

    // Get test, set expected args
    var test = this.tests[this.currenttest];
    this.args = test.args || [];

    // Unmark finished, just in case
    test.finished = false;

    // Send off a report, just in case we crash.
    this.sendReport(false);

    // Reset the test, signal loading state
    this.resetTest();
    this.setStatus(test.name + " loading");

    // Schedule test script load & test steps
    var result = this.loadTestIframe()
      .then(this.waitForTestSetup.bind(this))
      .catch(this.handleTestStepException.bind(this, test, { name: 'Loading test script', _rethrow: true }))
      .then(this.runAllTestSteps.bind(this));

    // Mark test as finished.
    result = result.finally(function() { test.finished = true; });

    // If we're in report mode, swallow any errors from loading the iframe / test registration
    if (this.reportid)
      result = result.catch(function(e){ console.error('Swallowed exception', e); });

    return result;
  }

  /** Loads the iframe with the test source
  */
  loadTestIframe()
  {
    var deferred = dompack.createDeferred();

    var test = this.tests[this.currenttest];

    let node_teststatus = document.querySelector(`#tests [data-testname="${test.name}"] .teststatus`);
    node_teststatus.textContent = "loading...";
    node_teststatus.scrollIntoView({ block: "nearest" });

    this.wait4setuptests = dompack.createDeferred();

    // Create a script - THEN add events. Might fail if not done in this order
    // No removing of events, this iframe will be thrown away on the next test
    this.scriptframe = dompack.create("iframe", { src: test.url });
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
  processTestIframe()
  {
    if(this.scriptframe.contentDocument)
    {
      this.scriptframedoc = this.scriptframe.contentDocument;
      this.scriptframewin = this.scriptframedoc.defaultView;
    }
    else if(this.scriptframe.contentWindow)
    {
      this.scriptframewin = this.scriptframe.contentWindow;
      this.scriptframedoc = this.scriptframewin.document;
    }
    else
      throw new Error("Unable to retrieve scriptframe window/document");

    this._recordAssetpacks(this.scriptframewin);
  }

  /// Waits for the test iframe js code to register its tests.
  waitForTestSetup()
  {
    // 1 minute should be enough. If the setup is earlier, their resolve will win (called from runTestSteps)
    this.timedReject(this.wait4setuptests, "Timeout waiting for test setup", 60000);
    return this.wait4setuptests.promise;
  }

  /// Runs all the test steps
  async runAllTestSteps()
  {
    var test = this.tests[this.currenttest];

    if (this.stop)
      return;

    if(! (this.currentsteps[0] && this.currentsteps[0].loadpage)) //no loadpage in first step? then init blak
      await this.doLoadPage({loadpage:"about:blank"},null);

    // Schedule all steps sequentially
    for(let idx = 0; idx < this.currentsteps.length; ++idx)
      await this.runTestStep(this.currentsteps[idx], idx);

    // Schedule a state update after all tests are done
    if (this.stop)
      return;

    // Set this.currentstep to one past the last step - triggers 'done' texts in uodateTestState. Looks nice.
    this.currentstep = this.currentsteps.length;
    this.setStatus(test.name + " " + this.currentsteps.length  + "/" + this.currentsteps.length);
    this.updateTestState();
  }

  /// Run a single test step
  runTestStep(step, idx)
  {
    this.currentstep = idx;
    this.lastbusycount = dombusy.getUIBusyCounter();

    console.log("[testfw] test:" + this.getCurrentStepName() + ", busycount = " + this.lastbusycount);
    var test = this.tests[this.currenttest];

    if (this.stop)
      return;

    // Translate legacy waits to modern format
    this.translateWaits(step);

    // Update the test state for this step, so the user knows we're running it.
    this.setStatus(test.name + " " + this.currentstep + "/" + this.currentsteps.length + (step.name ? ': ' + step.name : ''));
    this.updateTestState();

    // Result promise (chained with all the step parts)
    var result = Promise.resolve();

    if (step.ignore)
      return result;

    // Promise that is rejected with onerror triggers
    var deferred_onerror = dompack.createDeferred();

    // window.onerror handler (installed when window is loaded)
    var onerrorhandler = function(errormsg, url, linenumber, col, e)
      {
        this.handleWindowOnError(deferred_onerror, errormsg, url, linenumber, col, e);
      }.bind(this);
    this.steponerrorhandler = onerrorhandler;

    if (this.scriptframewin.Error && this.scriptframewin.Error.stackTraceLimit)
      this.scriptframewin.Error.stackTraceLimit = 50;

    if(! (dompack.debugflags.ner))
      this.scriptframewin.onerror = onerrorhandler;

    // Signals to detect if a page load happens (all properties are promises)
    this.currentsignals = { pageload: null };

    // Loadpage? Execute it first
    if (step.loadpage)
      result = result.then(this.doLoadPage.bind(this, step, onerrorhandler));

    // Initialize the signals and onerror - AFTER loading the page.
    result = result.then(function()
      {
        // Modify signals, don't re-assign! We want to modify the object bound to executeWait.
        this.currentsignals.pageload = this.waitForPageFrameLoad({ timeout: -1, onerrorhandler: onerrorhandler }); // no timeout

        // Install an onerror handler if not present yet
        if (this.pageframewin)
        {
          try
          {
            if (this.pageframewin.Error && this.pageframewin.Error.stackTraceLimit)
              this.pageframewin.Error.stackTraceLimit = 50;
            if(! (dompack.debugflags.ner))
              this.pageframewin.onerror = onerrorhandler;
            this.pageframewin_setonerror = true;
          }
          catch (e)
          {
            console.warn('Could not set onerror handler due to the following exception: ', e);
          }
        }
      }.bind(this));

    if(! (dompack.debugflags.ner))
      this.scriptframewin.onerror = onerrorhandler;

    // Test or wait? Execute it after the loadpage
    if (step.test || step.wait)
      result = result.then( () => this.executeStepTestFunction(step, idx));
    else if (step.email)
      result = result.then(this.executeStepEmail.bind(this, step, idx));

    // Schedule all waits serially after the tests. Clears signals if it uses them
    if (step.waits)
      step.waits.forEach(function(item) { result = result.then(this.executeWait.bind(this, step, item, this.currentsignals)); }.bind(this));

    // After the waits have all executed, see if a page load happened we did'nt expect
    result = result.then(() =>
      {
        // A 'pageload' wait clears signals.pageload. If not cleared, error out when the load happens
        if (this.currentsignals.pageload)
        {
          var err = new Error("Page load happened but was not expected");
          var errorfunc = function() { throw err; };
          // FIXME: test if this really works. As far as I read the specs, if signals.pageload is already resolved/rejected
          // it should win the race, ignoring the second Promise.resolve().
          return Promise.race([ this.currentsignals.pageload.then(errorfunc, errorfunc), Promise.resolve() ]);
        }
      });

    // Mix in errors from onerror handlers
    result = Promise.race([ deferred_onerror.promise, result ]);

    // If marked as xfail, give an error when no exception, and swallow exceptions (but note them & update state)
    if (step.xfail)
    {
      result = result.then(
        function() { throw new Error("Step " + idx + " should have failed, but didn't (is marked as xfail)"); },
        function()
          {
            // Note & swallow the execution
            test.xfails = test.xfails || [];
            test.xfails.push({ stepname: step.name||'', stepnr:idx, text: step.xfail, e:'Failed as expected'});
            this.updateTestState();
          }.bind(this));
    }

    // Remove the onerror handler
    result = result.finally(function()
      {
        this.currentsignals = null;
        test.runsteps = test.runsteps || [];
        test.runsteps.push({ stepname: step.name||'', stepnr:idx });

        if (this.pageframewin_setonerror && this.pageframewin)
        {
          this.pageframewin.onerror = null;
          this.pageframewin_setonerror = false;
        }
      }.bind(this));

    // Handle success / exceptions of the test
    result = result.then(
      this.handleTestStepSuccess.bind(this, test, step),
      this.handleTestStepException.bind(this, test, step));

    return result;
  }

  handleWindowOnError(deferred, errormsg, url, linenumber, col, e)
  {
  // Test if we should ignore this callback
    if (shouldIgnoreOnErrorCallback(errormsg))
      return;

    if (e && e.stack && (/http:/.exec(e.stack) || /https:/.exec(e.stack))) // Looks like and exception and do we have URL info in the stack member?
    {
      deferred.reject(e);
      return;
    }

    var msg = "Uncaught exception: " + errormsg;
    if (url)
    {
      if (browser.getName() == "chrome")
        msg += "\nat unknown (" + url + ":" + (linenumber || 1) + ":" || (col || 1) + ")";
      else
        msg += "\nunknown@" + url + ":" + (linenumber || 1) + ":" || (col || 1) + ")";
    }
    this.bindDeferredWithError(deferred, msg)();
  }

  /// Handles a succesfully completed step
  handleTestStepSuccess(test, step)
  {
    // Success: remove all log nodes, not interesting
    for (var i = 0; i < this.lastlognodes.length; ++i)
      if (this.lastlognodes[i].parentNode)
        this.lastlognodes[i].parentNode.removeChild(this.lastlognodes[i]);
    this.lastlognodes = [];
  }

  /// Handles a test step that errored out
  handleTestStepException(test, step, e)
  {
    let fullname = step.name ? step.name + (step.subname ? "#" + step.subname: "") : "";
    // Got a test exception. Log it everywhere
    var prefix = 'Test ' + test.name + ' step ' + (fullname ? fullname+' (#'+this.currentstep+')' : '#'+this.currentstep);
    var text = prefix + ' failed';

    console.warn(text);
    console.warn(e);

    this.log(prefix + (e ? " exception: " + e : " failed with unknown reason"));
    let lognode = this.log("Location: computing...");

    test.fails = (test.fails || []);
    let failrecord = { stepname:fullname, stepnr:this.currentstep, text:text, e:''+(e||''), stack:(e&&e.stack)||"", lognode };
    test.fails.push(failrecord);
    this.updateTestState();
    this.lastlognodes = [];

    e.testsuite_reported = true;
    // force the resolve, so we can use the stack trace for location resolving
    let res = reportException(e,
                        { extradata:
                            { __wh_jstestinfo:
                                  { reportid:     this.reportid
                                  , testname:     test.name
                                  , testlisturl:  this.testlisturl || ""
                                  }
                            }
                        , serviceuri:      "/wh_services/system/jstests"
                        , servicefunction: 'ReportJSError'
                        , forceresolve: true
                        });

    document.getElementById('skiptest').removeAttribute('disabled');

    res.then(({ stacktrace }) =>
    {
      console.log("Got stack trace:", stacktrace);

      let fullerrornode = qS('#fullerror');
      dompack.empty(fullerrornode);
      stacktrace.forEach(el =>
      {
        dompack.append(fullerrornode, `${el.filename}:${el.line}:${el.col}`, dompack.create('br'));
      });
      document.documentElement.classList.add('testframework--havefullerror');

      let filtered = stacktrace.filter(({ filename }) =>
          !filename.endsWith("/buildbabelexternalhelpers.js") &&
          !filename.endsWith("/ap.js") &&
          !filename.endsWith("/regenerator-runtime/runtime.js") &&
          !filename.endsWith("/testframework.es") &&
          !filename.endsWith("/testframework-rte.es") &&
          !filename.includes("/dompack/testframework/") &&
          !filename.endsWith("/testsuite.es"));

      if (filtered.length)
      {
        lognode.textContent = `Location: ${filtered[0].filename}:${filtered[0].line}:${filtered[0].col}`;
        this.updateTestState();
      }
    });

    // Swallow exception if in reportid mode unless running just one test (ADDME: abort the current test and move to the next test in reportid mode, but never run further steps)
    if (!this.reportid || step._rethrow || this.tests.length==1)
      throw e;
  }

  /// Execute a load page command
  doLoadPage(step, onerrorhandler)
  {
    var loadpage;
    if(typeof step.loadpage == 'string')
      loadpage = step.loadpage;
    else if(typeof step.loadpage == 'function')
      loadpage = step.loadpage(this.pageframedoc, this.pageframewin);

    if (dompack.debugflags.testfw)
      console.log('[testfw] doLoadPage: ' + loadpage);

    this.resetPageFrame();
    var iframe = dompack.create("iframe", { "id": "testframe", "name": "testframe" });
    document.getElementById('testframeholder').appendChild(iframe);
    iframe.src = loadpage;

    document.getElementById('currentwait').textContent = "Wait: pageload";
    document.getElementById('currentwait').style.display = "inline-block";

    return this.waitForPageFrameLoad({ onerrorhandler: onerrorhandler }).finally(function()
    {
      document.getElementById('currentwait').style.display = "none";
    });
  }

  /** Returns a promise that is fulfilled when the testframe iframe (re-)loads
      @param options
      @cell(boolean) options.timeout Timeout override
  */
  waitForPageFrameLoad(options)
  {
    var iframe = document.getElementById('testframe');
    var deferred = dompack.createDeferred();
    if (!iframe)
      return deferred.promise;

    if (!options || !options.timeout || options.timeout >= 0)
      this.timedReject(deferred, "Timeout waiting for test frame to load", (options||{}).timeout || this.loadtimeout);

    // Split setting events from event creation
    iframe.addEventListener("load", deferred.resolve);
    iframe.addEventListener("error", deferred.reject);

    // Remove both load/error events when receiving one of them
    deferred.promise.finally(() =>
      {
        iframe.removeEventListener("load", deferred.resolve);
        iframe.removeEventListener("error", deferred.reject);
      });

    // When the iframe has loaded, process it to get the doc & window. Just error out when loading failed.
    return deferred.promise.then(this.processLoadedTestFrame.bind(this, iframe, options));
  }

  /// Get & store the win.doc from the pageframe
  processLoadedTestFrame(pageframe, options)
  {
    this.pageframedoc = pageframe.contentDocument;
    this.pageframewin = this.pageframedoc.defaultView;
    if (dompack.debugflags.testfw)
      console.log('[testfw] loaded page: ' + this.pageframewin.location.href);

    this._recordAssetpacks(this.pageframewin);

    if (options && options.onerrorhandler && !this.pageframewin.onerror)
    {
      if(! (dompack.debugflags.ner))
        this.pageframewin.onerror = options.onerrorhandler;
      this.pageframewin_setonerror = true;
    }

    //this.uiwasbusy = true;

    //Implement focus handling
    //if(getActiveElement(document) != pageframe) //needed for IE8 test
      //pageframe.contentWindow.focus();

    var focusable = domfocus.getFocusableComponents(this.pageframedoc.documentElement);
    for (var i=0;i<focusable.length;++i)
    {
      if(focusable[i].autofocus)
      {
        focusable[i].focus();
        break;
      }
    }
    try
    {
      var doctitle = this.pageframedoc.title;
      if(doctitle == '404 Not found')
        throw new Error("The child frame returned a 404 error, please check the url");
    }
    catch(e)
    {
      throw new Error("Exception accessing child frame, assuming security error" + e);
    }

    if (this.pageframewin.Promise && Promise.__disabletrycatch)
      this.pageframewin.Promise.__disabletrycatch = Promise.__disabletrycatch;
  }

  _setSubName(step, name)
  {
    if(dompack.debugflags.testfw)
      console.log('[testfw] -- setsubname ', name);
    step.subtest = (step.subtest||0)+1;
    step.subname = name;
  }

  _checkClientAsyncFunc()
  {
    if (this.activeasyncerr)
    {
      let e = this.activeasyncerr;
      this.activeasyncerr = null;
      throw e;
    }
  }

  _checkClientAsync(promise)
  {
    this._checkClientAsyncFunc();
    this.activeasyncerr = new Error("This async function was not used with await!");
    return promise.finally(() => this.activeasyncerr = null);
  }

  setCallbacks(step)
  {
    if (!this.setcallbacksfunc)
      return;
    if (step)
      this.setcallbacksfunc(
          { executeWait: item => this._checkClientAsync(this.executeWait(step, item, this.currentsignals))
          , subtest: name => this._setSubName(step, name)
        });
    else
    {
      this._checkClientAsyncFunc();
      this.setcallbacksfunc(
          { executeWait: () => { throw new Error("calling test.wait outside test function"); }
          , subtest: () => { throw new Error("calling test.subtest outside test function"); }
          });
    }
  }

  /// Executes the step.test or test.wait functions
  executeStepTestFunction(step)
  {
    var deferred = dompack.createDeferred();

    var func = step.test || step.wait;

    // Initialize the callback for step.wait if needed
    var callback;
    if (step.wait)
      callback = deferred.resolve;

    var returnvalue;

    this.setCallbacks(step);

    returnvalue = func(this.pageframedoc, this.pageframewin, callback);

    //this.uiwasbusy = this.pageframewin && this.pageframewin.$wh && this.pageframewin.$wh.busycount > 0;
    if (step.wait || (returnvalue && returnvalue.then))
    {
      var text = "Wait: " + (step.wait ? "callback" : "test promise");
      document.getElementById('currentwait').textContent = text;
      document.getElementById('currentwait').style.display = "inline-block";
      deferred.promise = deferred.promise.finally(function() { document.getElementById('currentwait').style.display = "none"; });
    }

    if (step.test)
    {
      // Resolve deferred with the returnvalue of the test function. If a promise was returned, deferred will be fulfulled
      // with the result of the promise
      Promise.resolve(returnvalue)
        .finally(() => this.setCallbacks(null))
        .then(deferred.resolve, deferred.reject);

      // Also schedule a timeout
      this.timedReject(deferred, "Timeout waiting for promise returned by step.test to resolve", step.timeout || this.waittimeout);
    }
    else // Timeout on the callback, please. If the callback is earlier, it wins.
    {
      this.timedReject(deferred, "Timeout waiting for step.wait callback", step.timeout || this.waittimeout);
    }

    return deferred.promise;
  }

  async executeStepEmail(step)
  {
    var email = typeof step.email == "function" ? step.email() : step.email;
    let timeout = step.emailtimeout || 0;
    let count = step.emailcount || 1;

    let results = await testservice.retrieveEmails(email, timeout, count);
    return this.processStepEmailResults(step, results);
  }

  processStepEmailResults(step,emails)
  {
    emails.forEach(email =>
    {
      email.doc = this.scriptframedoc.createElement('div');
      email.doc.style.display="none";
      email.doc.innerHTML = email.html;
    });

    var retval = step.emailhandler(emails);
    if (retval)
      throw new Error("emailhandler returned result, that is not supported anymore");
  }

  /// Calls a wait functions, if it fails, request a re-test on the next animation frame
  repeatedFunctionTestIterate(func, deferred)
  {
    this.animationframerequest = 0;
    try
    {
      if (!func())
      {
        if (!this.pageframewin.requestAnimationFrame)
          throw new Error("waitforanimationframe specified, but no requestAnimationFrame found in scriptframe");
        this.animationframerequest = this.pageframewin.requestAnimationFrame(this.repeatedFunctionTestIterate.bind(this, func, deferred));
      }
      else
        deferred.resolve();
    }
    catch (e)
    {
      // func() threw. Not nice, report back.
      deferred.reject(e);
    }
  }

  repeatedFunctionTest(step, func)
  {
    var deferred = dompack.createDeferred();

    // When the test is cancelled, resolve the wait promise immediately
    this.stoppromise.promise.then(deferred.resolve, deferred.reject);

    // Schedule a timeout
    this.timedReject(deferred, "Timeout when waiting for function", step.timeout || this.waittimeout);

    // If the timeout triggers, cancel the animationframerequest
    deferred.promise.catch(function()
      {
        if (this.animationframerequest)
          this.pageframewin.cancelAnimationFrame(this.animationframerequest);
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
  async executeWait(step, item, signals)
  {
    var text = "Wait: " + (typeof item == "function" ? "function" : item);
    document.getElementById('currentwait').textContent = text;
    document.getElementById('currentwait').style.display = "inline-block";

    if (dompack.debugflags.bus)
      console.log("[bus] Start wait for '" + item + "'");

    // Type == function: execute function on every animation frame until it succeeds
    if (typeof item == "function")
    {
      // function in waits has signature func(doc, win)
      let promise = this.repeatedFunctionTest(step, item.bind(null, this.pageframedoc, this.pageframewin));
      if (dompack.debugflags.bus)
        promise = promise.then(function(x) { console.debug("Finished wait for '" + item + "'"); return x; });
      return promise.finally(this.executeWaitFinish.bind(this));
    }

    var deferred = dompack.createDeferred();
    if (dompack.debugflags.bus)
      deferred.promise = deferred.promise.then(function(x) { console.debug("Finished wait for '" + item + "'"); return x; });

    // When the test is cancelled, resolve the wait promise immediately
    this.stoppromise.promise.then(deferred.resolve, deferred.reject);

    // Number: just wait for so many milliseconds
    if (typeof item == "number")
    {
      setTimeout(deferred.resolve, item);
      return deferred.promise.finally(this.executeWaitFinish.bind(this));
    }

    switch (item)
    {
      case "events":
      {
        // wait 1 millisecond to process all events
        setTimeout(deferred.resolve, 1);
        return deferred.promise.finally(this.executeWaitFinish.bind(this));
      }
      case "ui":
      case "ui-nocheck":
      {
        if (item == 'ui' && this.lastbusycount == dombusy.getUIBusyCounter())
          throw new Error("'ui' wait requested but it was never busy since the test started, busycount = " + dombusy.getUIBusyCounter());

        dombusy.waitUIFree().then(deferred.resolve);
        this.timedReject(deferred, "Timeout when waiting for UI", step.timeout || this.waittimeout);
      } break;

      case "pointer":
      {
        if (!this.scriptframewin.waitForGestures)
          throw Error("waitforgestures specified, but no waitForGestures found in scriptframe");

        this.scriptframewin.waitForGestures(deferred.resolve);
        this.timedReject(deferred, "Timeout when waiting for gestures to finish", step.timeout || this.waittimeout);
      } break;
      case "uploadprogress":
      {
        if (!this.pageframewin.__todd)
          throw "doWaitForUploadProgress specified, but no $todd found in testframe";

        console.log('start wait for upload');
        this.pageframewin.__todd.waitForUploadProgress(deferred.resolve);
        deferred.promise.then(function() { console.log('upload done'); });

        this.timedReject(deferred, "Timeout when waiting for upload progress", step.timeout || this.waittimeout);
      } break;

      case "animationframe":
      {
        if (!this.pageframewin.requestAnimationFrame)
          throw new Error("waitforanimationframe specified, but no requestAnimationFrame found in scriptframe");
        this.pageframewin.requestAnimationFrame(deferred.resolve);
        this.timedReject(deferred, "Timeout when waiting for animation frame", step.timeout || this.waittimeout);
      } break;

      case "tick":
      {
        //ADDME setImmediate and mutationObserver, if available, are supposedly more accurate? https://github.com/medikoo/next-tick thinks so..
        setTimeout(deferred.resolve,1);
      } break;

      case "pageload":
      {
        if (!signals.pageload)
          throw new Error("Pageload promise was already used in earlier wait");

        this.timedReject(deferred, "Timeout when waiting for pageload", step.timeout || this.waittimeout);

        let promise = signals.pageload;
        signals.pageload = null;
        try
        {
          return await Promise.race([ promise, deferred.promise ]);
        }
        finally
        {
          this.currentsignals.pageload = this.waitForPageFrameLoad({ timeout: -1, onerrorhandler: this.steponerrorhandler }); // no timeout
          this.executeWaitFinish();
        }
      }
      case "scroll":
      {
        var scrollwaiter = function()
        {
          //this event will fire on scroll, and then schedule a delay() to allow other scroll handlers to run
          setTimeout(deferred.resolve, 0);
          this.pageframewin.removeEventListener("scroll", scrollwaiter);
        }.bind(this);
        this.pageframewin.addEventListener("scroll", scrollwaiter);
        this.timedReject(deferred, "Timeout when waiting for scrolle vent", step.timeout || this.waittimeout);
      } break;

      default:
      {
        throw new Error("Unimplemented wait type '" + item + "'");
      }
    }

    return deferred.promise.finally(this.executeWaitFinish.bind(this));
  }

  executeWaitFinish()
  {
    document.getElementById('currentwait').style.display = "none";
  }

  /// Translate the .waitxxx values in a test step to step.waits
  translateWaits(step)
  {
    let waits = step.waits || [];

    var translations =
      { waitforgestures:        'pointer'
      , waitforuploadprogress:  'uploadprogress'
      , waitwhtransitions:      'ui'
      , waitforanimationframe:  'animationframe'
      };

    Object.entries(translations, function([ name, value ])
      {
        if (step[name])
        {
          console.error(name + " is deprecated, use waits:[\""+value+"\"]");
          waits.push(value);
          delete step[name];
        }
      });

    if (step.expectload)
    {
      console.error('expectload is deprecated, use a normal test() and waits: ["pageload"]', step);
      step.test = step.expectload;
      delete step.expectload;
      waits.unshift('pageload');
    }

    if (step.waituntil)
    {
      console.error('waituntil is deprecated, use waits: [function(doc, win) { ... } ]', step);
      waits.unshift(step.waituntil);
      delete step.waituntil;
    }

    if (waits.length)
      step.waits = waits;
  }

  // Batch log entries every 100ms
  _scheduleSeleniumLog(method, args)
  {
    this.scheduledlogs.push({ method, args, time: Date.now() });
    if (!this.scheduledlogscb)
      this.scheduledlogscb = setTimeout(() => this._sendSeleniumLogs(), 100);
  }

  // send out all logs
  _sendSeleniumLogs()
  {
    this.scheduledlogscb = null;
    if (this.scheduledlogs.length)
    {
      testservice.JSTestLog([ this.testfw.reportid, this.scheduledlogs ]);
      this.scheduledlogs = [];
    }
  }

  // standardize stacks to 'funcname@http-location:line:col'
  _standardizeStack(stack, oneline)
  {
      let slicepoint = browser.getName() === "firefox" ? 2 : 3;
      let items = stack.split("\n").slice(slicepoint);
      return items.map(line =>
      {
        line = line.replace("   at ", "");
        line = line.replace("   at ", "");
        line = line.replace(" (", "@");
        if (line.endsWith(")"))
          line = line.slice(0, -1);
        return line;
      }).join("\n");
  }

  _recordAssetpacks(wnd)
  {
    var test = this.tests[this.currenttest];
    let scripttags = wnd.document.getElementsByTagName("script");
    for (let tag of Array.from(scripttags))
    {
      let match = tag.src.match(/\/.ap\/([^/]*)\/ap.js$/);
      if (match)
      {
        test.assetpacks = (test.assetpacks) || [];
        test.assetpacks.push(match[1]);
      }
    }
  }

  guaranteeTestNames(steps)
  {
    var lastname = 'unnamed test', lastcount = 0;
    for (const step of steps)
    {
      if(step.name)
      {
        lastname = step.name;
        lastcount = 1;
      }
      else
      {
        step.name = lastname + (lastcount ? " (" + ++lastcount + ")" : "");
      }
    }
  }

  runTestSteps(steps, setcallbacksfunc, testexports)
  {
    if(this.currentsteps)
      return console.error("Multiple teststeps received");
    this.setcallbacksfunc = setcallbacksfunc;

    //for debugging, offer access to 'test' and 'testfw' in the main frame
    window.test = testexports;

    this.currentsteps = steps;
    this.guaranteeTestNames(this.currentsteps);

    if(dompack.debugflags.testfw)
      console.log(`[testfw] ${steps.length} steps have been registered`);
    if (this.wait4setuptests.resolve)
      this.wait4setuptests.resolve();
    else
      this.wait4setuptests.donePreload(true);

    // Pass selenium data back to the test script
    return (
        { seleniumref: document.body.getAttribute('data-seleniumref')
        , testsession: document.body.getAttribute('data-testsession')
        });
  }

  log(text)
  {
    var nodes = [ document.createTextNode(text), document.createElement("br") ];
    this.lastlognodes.push(nodes[0]);
    this.lastlognodes.push(nodes[1]);

    document.getElementById('logholder').appendChild(nodes[0]);
    document.getElementById('logholder').appendChild(nodes[1]);
    return nodes[0];
  }

  updateTestState()
  {
    var test = this.tests[this.currenttest];
    if (!test)
    {
      console.error('no test found', this.currenttest, this.tests.length);
      console.trace();
    }
    let node_teststatus = document.querySelector(`#tests [data-testname="${test.name}"] .teststatus`);
    if (this.currentstep == -1)
    {
      node_teststatus.textContent = "test not loaded";
      Object.assign(node_teststatus.style, { 'font-weight': 'bold', 'color': '#FF0000' });
    }
    else
    {
      var stepname = (this.currentsteps[this.currentstep]||{}).name;
      var xfails = test.xfails ? ' (xfails: ' + test.xfails.map(function(v){return v.stepnr+(v.stepname?': '+v.stepname:'');}).join(', ') + ')' : '';
      var fails = test.fails ? ' (fails: ' + test.fails.map(function(v){return v.stepnr+(v.stepname?': '+v.stepname:'');}).join(', ') + ')' : '';

      var suffix=(stepname ? ': ' + stepname : '') + fails + xfails;
      if(!suffix && this.currentstep>=this.currentsteps.length)
        suffix += ' - done';

      node_teststatus.textContent = this.currentstep + "/" + this.currentsteps.length + suffix;
      if (fails)
        Object.assign(node_teststatus.style, { 'font-weight': 'bold', 'color': '#FF0000' });
      else
        Object.assign(node_teststatus.style, { 'font-weight': 'normal', 'color': '#000000' });
      node_teststatus.scrollIntoView({ block: "nearest" });
    }
  }

  startNextStep()
  {
    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    setTimeout(() => this.startNextStepNow(), 0);
  }
  doWaitOutDelay()
  {
    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    setTimeout(() => this.this.startNextStepNow(), this.delayafter);
    this.delayafter=0;
  }
  doWaitForGestures()
  {
    this.waitforgestures=false;
    if(!this.scriptframewin.waitForGestures)
      throw "waitforgestures specified, but no waitForGestures found in scriptframe";

    if (this.nextstepscheduled)
      return;

    this.nextstepscheduled = true;
    this.scriptframewin.waitForGestures(this.startNextStepNow.bind(this));
  }
  doWaitForUploadProgress()
  {
    this.waitforuploadprogress = false;
    if(!this.pageframewin.__todd)
      throw "doWaitForUploadProgress specified, but no $todd found in testframe";

    this.pageframewin.__todd.waitForUploadProgress(this.startNextStepNow.bind(this));
  }
  doWaitForAnimationFrame()
  {
    this.waitforanimationframe=false;
    if(!this.pageframewin.requestAnimationFrame)
      throw "waitforanimationframe specified, but no requestAnimationFrame found in scriptframe";

    this.pageframewin.requestAnimationFrame(this.startNextStepNow.bind(this));
  }

  getCurrentStep()
  {
    return this.currentsteps[this.currentstep];
  }

  getCurrentStepName()
  {
    return this.getCurrentStep().name;
  }
}

class TestSuite
{
  constructor()
  {
    this.gottests = false;
    this.started = false;
    dompack.onDomReady( () => this.onDomReady());
  }

  onDomReady()
  {
    this.testfw = new TestFramework;

    this.getTestList();

    document.getElementById('toggleautostart').addEventListener('click', () => this.toggleAutoStart());
    document.getElementById('opentestframe').addEventListener("click", () => this.openTestFrame());
    document.getElementById('skiptest').addEventListener("click", () => this.skipTest());
    if (!this.autostart)
    {
      document.getElementById('toggleautostart').textContent = "Enable autostart";
      document.getElementById('starttests').addEventListener("click", event =>
      {
        document.getElementById('starttests').disabled = true;
        event.target.blur();
        this.testlistpromise.then(() => this.startTests());
      });
    }
    else
    {
      document.getElementById('toggleautostart').textContent = "Disable autostart";
      document.getElementById('starttests').disabled = true;
    }
  }

  getTestList()
  {
    var url = new URL(location.href);
    let masks = (url.searchParams.get('mask') || "*").split(",");
    let skips = url.searchParams.get('skip') ? url.searchParams.get('skip').split(",") : [];

    let testlisturl = document.body.dataset.testslist;
    testlisturl = new URL(testlisturl, location.href);
    this.testlistpromise = fetch(testlisturl, { credentials: "same-origin" })
        .then(response => response.json()).then(list =>
    {
      let filtered = [];

      list.forEach(item =>
      {
        if (!masks.some(mask => minimatch(item.name, mask)) || skips.some(mask => minimatch(item.name, mask)))
          return;

        let li = dompack.create("li", { dataset: { testname: item.name } });
        let url = new URL(location.href);
        url.searchParams.set("nocatch", "1");
        url.searchParams.set("skip", "");
        url.searchParams.set("autotests", "");
        url.searchParams.set("reportid", "");
        url.searchParams.set("startat", "");
        url.searchParams.delete("mask"); //we want it to be last for easier url editing, quick fix...
        url.searchParams.set("mask", item.name);

        item.url = new URL(item.url, testlisturl).toString();

        li.appendChild(dompack.create("a", { href: url.toString(), textContent: item.name }));
        if (item.isjs)
          li.appendChild(document.createTextNode(" (.js) "));
        else
          li.appendChild(document.createTextNode(" "));

        if(item.tags.length)
          li.appendChild(dompack.create("span", { className: "tags", textContent: `(${item.tags.join(', ')}) ` }));

        li.appendChild(dompack.create("span", { className: "teststatus" }));

        document.getElementById("tests").appendChild(li);
        filtered.push(item);
      });

      if ([ "1", "true" ].includes(url.searchParams.get('nocatch')))
        this.testfw.catchexceptions=false;

      this.testfw.reportid=url.searchParams.get('reportid');
      this.testfw.testlisturl = testlisturl;
      this.testfw.addTests(filtered);
      this.gottests = true;

      if(url.searchParams.get('autostart'))
        this.autostart = url.searchParams.get('autostart') != '0';
      else
        this.autostart = qSA('#tests li').length == 1;

      if (this.autostart)
        this.startTests();

    });
  }

  toggleAutoStart()
  {
    var url = new URL(window.location.href);
    url.set('autostart', this.autostart ? '0' : '1');
    location.href = url.toString();
  }

  startTests()
  {
    if (!this.gottests)
      this.autostart = true;
    else
    {
      if (this.started)
        return;
      this.started = true;

      this.testfw.runTests();
    }
  }

  skipTest()
  {
    this.testfw.skipTest();
  }

  onError(response)
  {
    console.error("Function invocation failed", response);
    alert("test runner failed\n" + response.error.message);
  }

  openTestFrame()
  {
    let href=null;
    try
    {
      href = getTestRoots().win.location.href;
    }
    catch(e)
    {
      console.log("getting location failed", e);
      href = document.getElementById('testframeholder').firstChild.src;
    }
    window.open(href, testframetabname);
  }
}

new TestSuite;

