/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';

//just number RPCs globally instead of per server, makes debug ouput more useful
let globalseqnr = 1;

function getDebugAppend() {
  const urldebugvar = window.location.href.match(new RegExp('[?&#]wh-debug=([^&#?]*)'));
  return urldebugvar ? '?wh-debug=' + urldebugvar[1] : '';
}

/* this is the followup for net/jsonrpc.es - we can hopefully clear net/ someday
   and move net/eventserver to wh/eventserver.es then */

class ControlledCall {
  abortcontroller = new AbortController;
  timeout;
  _callurl;
  _fetchoptions;
  promise: Promise<unknown>;
  timedout = false;
  aborted = false;
  legacyresolve;

  constructor(public client, method, stack, id, public options, callurl, fetchoptions) {
    // if(options.timeout || options.signal) //as long as rpcResolve exists, we'll ALWAYS need to setup a controller
    {
      fetchoptions.signal = this.abortcontroller.signal;

      if (options.timeout > 0) {
        this.timeout = options.timeout;
        setTimeout(() => this._handleTimeout(), options.timeout);
      }
      if (options.signal) {
        options.signal.addEventListener("abort", () => this._abort());
      }
    }

    this._callurl = callurl;
    this._fetchoptions = fetchoptions;

    const fetchpromise = fetch(this._callurl, this._fetchoptions);
    this.promise = this._completeCall(method, stack, id, fetchpromise);
    this.promise.__jsonrpcinfo = this;
  }
  _handleTimeout() {
    this.timedout = true;
    this.abortcontroller.abort();
  }
  _abort() {
    this.aborted = true;
    this.abortcontroller.abort();
  }
  _legacyResolve(resolution) {
    this.legacyresolve = resolution;
    this.abortcontroller.abort();
  }
  async _completeCall(method, stack, id, fetchpromise) {
    let response;
    try {
      while (true) { //loop for 429
        response = await fetchpromise;
        if (response.status === 429 && !("retry429" in this.options && !this.options.retry429) && response.headers.get("Retry-After")) {
          const retryafter = parseInt(response.headers.get("Retry-After"));
          if (this.options.debug)
            console.warn(`[rpc] We are being throttled (429 Too Many Requests) - retrying after ${retryafter} seconds`);

          await new Promise(resolve => setTimeout(resolve, retryafter * 1000));
          fetchpromise = fetch(this._callurl, this._fetchoptions);
          continue;
        }
        break;
      }
    } catch (exception) {
      if (this.options.debug)
        console.log(`[rpc] #${id} Exception invoking '${method}'`, exception);

      if (this.aborted)
        throw new Error(`RPC Aborted`);
      else if (this.timedout)
        throw new Error(`RPC Timeout: timeout was set to ${this.timeout} milliseconds`);
      else if (this.legacyresolve && this.legacyresolve.resolve)
        return this.legacyresolve.resolve;
      else
        throw new Error(`RPC Failed: exception: ` + exception);
    }

    let jsonresponse;
    try {
      jsonresponse = await response.json();
      if (this.options.debug)
        console.log(`[rpc] #${id} Received response to '${method}'`, jsonresponse);
    } catch (exception) {
      if (this.options.debug)
        console.warn(`[rpc] #${id} Response was not valid JSON`, exception);
    }

    if (!jsonresponse)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    if (jsonresponse && jsonresponse.error) {
      this.client._tryLogError(stack, jsonresponse.error);
      throw new Error("RPC Error: " + (jsonresponse.error.message || "Unknown error"));
    }

    if (response.status === 200 && jsonresponse && jsonresponse.id !== id)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    if (this.options.wrapresult) {
      return {
        status: response.status,
        result: jsonresponse.result || null,
        error: jsonresponse.error || null,
        retryafter: response.headers.get("Retry-After") ? parseInt(response.headers.get("Retry-After")) : null
      };
    }

    return jsonresponse.result;
  }
}

/** Invokes (WebHare) JSON/RPC
    @param url - URL to invoke (leave empty or pass no parameters at all to callback to the current page)
    options.timeout Default timeout for all calls
    options.debug Debug (Follows 'rpc' debugflag if not explicity specified)
    @deprecated Switch to \@webhare/jsonrpc */
export default class RPCClient {
  options;
  url: string;
  addfunctionname;
  urlappend;
  constructor(url: string, options?) {
    this.options = {
      timeout: 0,
      debug: dompack.debugflags.rpc,
      ...options
    };

    let whservicematch;
    if (url) {
      whservicematch = url.match(/^([a-z0-9_]+):([a-z0-9_]+)$/);
      if (whservicematch)
        this.url = `${location.origin}/wh_services/${whservicematch[1]}/${whservicematch[2]}`;
      else
        this.url = url;
    } else {
      this.url = location.href;  //invoke ourselves directly if no path specified
    }

    //if shorthand syntax is used, we know we're talking to our local webhare. add function names and the profiling flag if needed
    this.addfunctionname = this.options.addfunctionname !== undefined ? this.options.addfunctionname : Boolean(whservicematch);
    this.urlappend = this.options.urlappend !== undefined ? this.options.urlappend : whservicematch ? getDebugAppend() : "";
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
  }

  _handleLegacyRPCResolve(promise, result) {
    if (!promise.__jsonrpcinfo)
      throw new Error("The promise is not an async JSONRPC request");
    promise.__jsonrpcinfo._legacyResolve({ resolve: result });
  }

  _tryLogError(stack, error) {
    const trace = error.data ? (error.data.trace || error.data.list || []) : [];

    console.group();
    console.warn("RPC failed:", error.message);
    trace.forEach(rec => {
      if (rec.filename || rec.line) {
        const line = rec.filename + '#' + rec.line + '#' + rec.col + (rec.func ? ' (' + rec.func + ')' : '');
        console.log(line);
      }
    });
    if (stack) {
      console.warn("Stack at calling point");
      console.log(stack);
    }
    console.groupEnd();
  }

  invoke(...params: unknown[]) {
    let options;
    if (typeof params[0] === "object")
      options = { ...this.options, ...params.shift() };
    else
      options = this.options;

    const method = params.shift();

    //build the URL, add profiling and function parameters where needed
    let callurl = this.url;
    if (this.addfunctionname) //simplifies log analysis, ignored by the server
      callurl += `/${method}`;
    callurl += this.urlappend;

    const id = ++globalseqnr;
    let stack;

    if (options.debug) {
      stack = new Error().stack;
      console.log(`[rpc] #${id} Invoking '${method}'`, params, callurl);
    }

    const fetchoptions = {
      method: "POST",
      credentials: 'same-origin', //this is the default since 2017-08-25, but Edge pre-18 is still around and will fail here
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(
        {
          id: id,
          method: method,
          params: params || []
        }),
      keepalive: Boolean(options.keepalive)
    };

    return new ControlledCall(this, method, stack, id, options, callurl, fetchoptions).promise;
  }
}

class JSONRPCService { //originally generated inline by the rpcloader.ts
  rpcclient;

  static get HTTP_ERROR() { return -1; } // Error connecting to the RPC server
  static get JSON_ERROR() { return -2; } // The returned value could not be decoded into a JSON object
  static get PROTOCOL_ERROR() { return -3; } // The return object did not contain an id, or the id did not match the request id
  static get RPC_ERROR() { return -4; } // The RPC returned an error
  static get OFFLINE_ERROR() { return -5; } // The application is not online (only returned if the onlineonly option was set)
  static get TIMEOUT_ERROR() { return -6; } // The request could not be sent or was not answered before within the timeout set in the options
  static get SERVER_ERROR() { return -7; } // The server encountered an internal error

  constructor(service: string) {
    this.rpcclient = new RPCClient(service);
  }

  rpcResolve(promise: Promise<unknown>, result: unknown) {
    this.rpcclient._handleLegacyRPCResolve(promise, result);
  }
  invoke(...args: unknown[]) {
    return this.rpcclient.invoke(...args);
  }
}

class JSONRPCServiceProxy {
  get(target: JSONRPCService, prop: string, receiver: unknown) {
    if (prop in target)
      return Reflect.get(target, prop, receiver);
    //it's a call, turn into an invoke
    return (...args: unknown[]) => target.invoke(prop, ...args);
  }
}

export function createService(name: string) {
  const service = new JSONRPCService(name);
  return new Proxy(service, new JSONRPCServiceProxy);
}
