/** Experimental library that helps tracing the source of unallocated resources */

function getStackTrace() {
  return (new Error).stack.toString();
}

globalThis.Promise.prototype.foundit = true;

class TracedPromise extends Promise {
  constructor(...args) {
    super(...args);
    this.traceInfo = getStackTrace();
  }
}

globalThis.Promise = TracedPromise;

const saveresolve = globalThis.Promise.resolve.bind(globalThis.Promise);
const savereject = globalThis.Promise.reject.bind(globalThis.Promise);

globalThis.Promise.resolve = function tracedResolve(...args) {
  const result = saveresolve(...args);
  result.traceInfo = getStackTrace();
  return result;
}

globalThis.Promise.reject = function tracedReject(...args) {
  const result = savereject(...args);
  result.traceInfo = getStackTrace();
  return result;
}

const savetimeout = globalThis.setTimeout;
const saveinterval = globalThis.setInterval;

globalThis.setTimeout = function setTracedTimeout(...args) {
  const result = savetimeout(...args);
  result.traceInfo = getStackTrace();
  return result;
}
globalThis.setInterval = function setTracedInterval(...args) {
  const result = saveinterval(...args);
  result.traceInfo = getStackTrace();
  return result;
}

