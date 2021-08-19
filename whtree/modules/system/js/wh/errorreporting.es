/** @import import * as utilerror from '@mod-system/js/wh/errorreporting';
*/

/* This libraries monitors root.error and reports errors to the webhare notice log
*/

import * as dompack from 'dompack';
var JSONRPC = require('@mod-system/js/net/jsonrpc');
import * as browser from 'dompack/extra/browser';
let StackTrace = require("stacktrace-js");

var haveerror = false;
var mayreport = true;
var saved_onerror = null;

// Determine root object
var root;
if (typeof window != "undefined")
  root = window;
else if (typeof self != "undefined")
  root = self;

// With promise debugging, we replace the promise constructor to add a stack trace to the promise
// at construction time, so we can trace where the rejected promise came from
if (dompack.debugflags.pro)
{
  const P = Promise;
  let MyPromise = function(executor)
  {
    let p = new P(executor);
    p.error = new Error("unhandled rejected promise");
    p.__proto__ = MyPromise.prototype;
    return p;
  };
  MyPromise.__proto__ = P;
  MyPromise.prototype.__proto__ = P.prototype;
  root.Promise = MyPromise;
}

function correctWebpackFilename(url)
{
  if (url.match(/webpack:\/\/\/[^/]/))
    url = "webpack:////" + url.slice(11);
  return url;
}

function installHandlers()
{
  // We'll use the onerror handler - the error event doesn't give much extra stuff
  // and won't work in ie<=10 and safari anyways

  saved_onerror = root.onerror;
  root.onerror = handleOnError;

  root.addEventListener('unhandledrejection', async event =>
  {
    console.log("unhandled rejection", event);
    if (dompack.debugflags.pro && event.promise.error)
      reportException(event.promise.error);
  });
}

function resetMayReport()
{
  mayreport = true;
}

var reported = [];
let sourceCache = {};
let reportPromise = null;

/** Send an exception
    @param errorobj Error exception
    @param options
    @cell options.altstack Alternative exception text to show when the exception has no stack member
    @cell options.forcesend Always send the exception (no throttling)
    @cell options.extradata Extra data to mix in with the report
    @cell options.serviceuri Alternative serviceuri to use
    @cell options.servicefunction Alternative servicefunction to use
*/
async function reportException(errorobj, options)
{
  options = options || {};

  //try {  console.log("reportException", errorobj, errorobj.stack) }catch(e) {}
  var exception_text = '';
  if (errorobj && typeof errorobj === "object") // Firefox may throw permission denied on stack property
  {
    try
    {
      exception_text = errorobj.stack;
      let firstline = errorobj.name + ": " + errorobj.message;
      if (exception_text.beginsWith(firstline))
        exception_text = firstline + "\n" + exception_text;
    }
    catch (e)
    {
    }
  }

  if (!exception_text && options && options.altstack)
    exception_text = options.altstack;

  if (!exception_text)
    try { exception_text = JSON.stringify(errorobj); } catch (e) {}
  if (!exception_text)
    try { exception_text = errorobj.toString(); } catch (e) {}

  // Max 10 reports per page, and no duplicates
  let shouldsend = reported.length <= 10 && !reported.includes(exception_text);
  if (!shouldsend && !options.forcesend && !options.forceresolve)
    return;

  let resolve, promise = new Promise(res => resolve = res);
  reportPromise = (reportPromise ||  Promise.resolve(true)).then(() => promise);
  try
  {
    reported.push(exception_text);

    let stackframes;
    try
    {
      console.info("Getting stack trace for exception");
      // Must specify a sourceCache to avoid duplicate requests
      if(StackTrace)
      {
        stackframes = await StackTrace.fromError(errorobj, { sourceCache });
        stackframes = stackframes.map(frame => (
            { line:       frame.lineNumber
            , func:       frame.functionName
            , filename:   correctWebpackFilename(frame.fileName)
            , col:        frame.columnNumber
            }));
      }
    }
    catch (e)
    {
      console.info("Could not retrieve stack trace", e.stack||e);
    }

    if (!shouldsend && !options.forcesend)
      return ({ stacktrace: stackframes });

    var data =
        { v:        1
        , browser:  browser.getTriplet()
        , location: location.href
        , error:    exception_text
        , trace:    stackframes
        };

    if (options && options.extradata)
    {
      for (var name in options.extradata)
        if (options.extradata.hasOwnProperty(name))
          data[name] = options.extradata[name];
    }

    if(typeof(root.location) == 'undefined')
      return;

    var serviceuri = (new URL((options && options.serviceuri) || "/wh_services/publisher/designfiles/", root.location.href)).toString();
    var rpc = new JSONRPC({ url: serviceuri, timeout: 10000 });
    rpc.request((options && options.servicefunction) || "ReportJavaScriptError", [ data ]);

    if (stackframes)
    {
      console.warn("Reported exception: ", exception_text);
      console.warn("Translated trace: " + stackframes.map(s => `\n at ${s.func||""} (${s.filename}:${s.line}:${s.col})`).join(""));
    }
    else
      console.warn('Reported exception: ', exception_text);

    return ({ stacktrace: stackframes });
  }
  finally
  {
    resolve(true);
  }
}

function handleOnError(errormsg, url, linenumber, column, errorobj)
{
  // Test if we should ignore this callback
  if (shouldIgnoreOnErrorCallback(errormsg))
    return false;

  if (!mayreport)
  {
    console.log('not reporting exception, first waiting for a click', errormsg);
    return false;
  }
  try
  {
    mayreport = false;

    var altstack = 'onerror:' + errormsg;
    if (url)
      altstack += "\nat unknown_function (" + url + ":" + linenumber + ":" + (column || 1) + ")";

    reportException(errorobj, { altstack: altstack });

    if (!haveerror && root.addEventListener)
      root.addEventListener('click', resetMayReport, true);

    haveerror = true;
  }
  catch (e)
  {
    try //IE unspecified errors may refuse to be printed, so be prepared to swallow even this
    {
      console.error('Exception while reporting earlier exception', e);
    }
    catch(e)
    {
      try
      {
        console.error('Exception while reporting about the exception about an earlier exception');
      }
      catch(e)
      {
        /* we give up. console is crashing ? */
      }
    }
  }

  if (saved_onerror)
    return saved_onerror.apply(this, arguments);
  return false;
}

function shouldIgnoreOnErrorCallback(errormsg)
{
  // Firefox fires the performance warning 'mutating the [[Prototype]] of an object will cause your code to run very slowly; instead ...'
  // via onerror. Ignore it, it is not an error.
  if (/mutating the \[\[Prototype\]\] of an/.exec(errormsg))
    return true;

  return false;
}

/** If any reports have been issued, returns a promise that will be resolved when all reports have been submitted.
    Returns null otherwise.
*/
function waitForReports()
{
  return reportPromise;
}

if(!dompack.debugflags.ner)
  installHandlers();

module.exports =
    { reportException: reportException
    , shouldIgnoreOnErrorCallback: shouldIgnoreOnErrorCallback
    , waitForReports
    };
