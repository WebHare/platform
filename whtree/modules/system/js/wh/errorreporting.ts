/* eslint-disable no-restricted-globals */

/* This libraries monitors root.error and reports errors to the webhare notice log
*/

import { debugFlags } from "@webhare/env";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- not fully converted to TS yet
const JSONRPC = require('@mod-system/js/net/jsonrpc');
import * as browser from 'dompack/extra/browser';
import StackTrace from "stacktrace-js";
import { isError } from "@webhare/std";

let haveerror = false;
let mayreport = true;
let saved_onerror: typeof onerror = null;

// Determine root object
let root: typeof self;
if (typeof window !== "undefined")
  root = window;
else if (typeof self !== "undefined")
  root = self;

// With promise debugging, we replace the promise constructor to add a stack trace to the promise
// at construction time, so we can trace where the rejected promise came from
if (debugFlags.pro) {
  const P = Promise;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type MyAny = any;
  const MyPromise = function (executor: MyAny) {
    const p = new P(executor) as MyAny;
    p.error = new Error("unhandled rejected promise");
    p.__proto__ = MyPromise.prototype;
    return p;
  };
  MyPromise.__proto__ = P;
  MyPromise.prototype.__proto__ = P.prototype;
  root!.Promise = MyPromise as MyAny;
}

function installHandlers() {
  // We'll use the onerror handler - the error event doesn't give much extra stuff
  // and won't work in ie<=10 and safari anyways

  saved_onerror = root.onerror;
  root.onerror = handleOnError;

  root.addEventListener('unhandledrejection', event => {
    console.log("unhandled rejection", event);
    if (debugFlags.pro && (event.promise as Promise<unknown> & { error: Error }).error)
      void reportException((event.promise as Promise<unknown> & { error: Error }).error);
  });
}

function resetMayReport() {
  mayreport = true;
}

const reported: string[] = [];
const sourceCache = {};
let reportPromise: Promise<unknown> | null = null;

/** Send an exception
    @param errorobj - Error exception
    @param options -
    - options.altstack: Alternative exception text to show when the exception has no stack member
    - options.forcesend: Always send the exception (no throttling)
    - options.extradata: Extra data to mix in with the report
    - options.serviceuri: Alternative serviceuri to use
    - options.servicefunction: Alternative servicefunction to use
*/
export async function reportException(errorobj: Error, options?: { altstack?: string; forcesend?: boolean; forceresolve?: boolean; extradata?: object; serviceuri?: string; servicefunction?: string }) {
  options = options || {};

  //try {  console.log("reportException", errorobj, errorobj.stack) }catch(e) {}
  let exception_text = '';
  if (isError(errorobj))
    exception_text = `${errorobj.name}: ${errorobj.message}`;

  if (!exception_text && options && options.altstack)
    exception_text = options.altstack;

  if (!exception_text)
    try { exception_text = JSON.stringify(errorobj); } catch (e) { }
  if (!exception_text)
    try { exception_text = errorobj.toString(); } catch (e) { }

  // Max 10 reports per page, and no duplicates
  const shouldsend = reported.length <= 10 && !reported.includes(exception_text);
  if (!shouldsend && !options.forcesend && !options.forceresolve)
    return;

  const { resolve, promise } = Promise.withResolvers<boolean>();
  reportPromise = (reportPromise || Promise.resolve(true)).then(() => promise);
  try {
    reported.push(exception_text);

    let stackframes;
    try {
      console.info("Getting stack trace for exception", errorobj);
      // Must specify a sourceCache to avoid duplicate requests
      if (StackTrace) {
        const parsedStackFrames = await StackTrace.fromError(errorobj, { sourceCache });
        stackframes = parsedStackFrames.map(frame => (
          {
            line: frame.lineNumber || 0,
            functionname: frame.functionName || "unknown",
            filename: (frame.fileName || "unknown").replace("/@whpath/", ""),
            column: frame.columnNumber || 0
          }));
      }
    } catch (e) {
      console.info("Could not retrieve stack trace", (e as Error).stack || e);
    }

    if (!shouldsend && !options.forcesend)
      return ({ stacktrace: stackframes });

    type Data = {
      v: number;
      browser: { name: string };
      location: string;
      message: string;
      trace: Array<{ line: number; functionname: string; filename: string; column: number }> | undefined;
      data?: object;
    };

    const data: Data = {
      v: 1,
      browser: { name: browser.getTriplet() },
      location: location.href,
      message: exception_text,
      trace: stackframes,
    };

    if (options && options.extradata) {
      data.data = Object.fromEntries(Object.entries(options.extradata));
    }

    if (typeof (root.location) === 'undefined')
      return;

    const serviceuri = (new URL((options && options.serviceuri) || "/wh_services/publisher/designfiles/", root.location.href)).toString();
    const rpc = new JSONRPC({ url: serviceuri, timeout: 10000 });
    rpc.request((options && options.servicefunction) || "ReportJavaScriptError", [data]);

    if (stackframes) {
      console.warn("Reported exception: ", exception_text);
      console.warn("Translated trace: " + stackframes.map(s => `\n at ${s.functionname || ""} (${s.filename}:${s.line}:${s.column})`).join(""));
    } else
      console.warn('Reported exception: ', exception_text);

    return ({ stacktrace: stackframes });
  } finally {
    resolve(true);
  }
}

function handleOnError(errormsg: Event | string, url?: string, linenumber?: number, column?: number, errorobj?: Error) {
  // Test if we should ignore this callback
  if (typeof errormsg !== "string" || shouldIgnoreOnErrorCallback(errormsg))
    return false;

  if (!mayreport) {
    console.log('not reporting exception, first waiting for a click', errormsg);
    return false;
  }
  try {
    mayreport = false;

    let altstack = 'onerror:' + errormsg;
    if (url)
      altstack += "\nat unknown_function (" + url + ":" + linenumber + ":" + (column || 1) + ")";

    if (errorobj)
      void reportException(errorobj, { altstack: altstack });

    if (!haveerror && root.addEventListener)
      root.addEventListener('click', resetMayReport, true);

    haveerror = true;
  } catch (e) {
    console.error('Exception while reporting earlier exception', e);
  }

  if (saved_onerror) {
    // @ts-ignore -- This works, but TS complains
    // eslint-disable-next-line @typescript-eslint/no-invalid-this, prefer-rest-params
    return saved_onerror.apply(this, arguments);
  }
  return false;
}

export function shouldIgnoreOnErrorCallback(errormsg: string) {
  // Firefox fires the performance warning 'mutating the [[Prototype]] of an object will cause your code to run very slowly; instead ...'
  // via onerror. Ignore it, it is not an error.
  if (/mutating the \[\[Prototype\]\] of an/.exec(errormsg))
    return true;

  return false;
}

/** If any reports have been issued, returns a promise that will be resolved when all reports have been submitted.
    Returns null otherwise.
*/
export function waitForReports() {
  return reportPromise;
}

if (!debugFlags.ner)
  installHandlers();
