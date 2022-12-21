import * as env from "@webhare/env";

//just number RPCs globally instead of per server, makes debug ouput more useful
let globalseqnr = 1;

export interface RPCCallOptions {
  /** Append function name to URLs. Purely for better logging/visibility as the WebHare JSONRPC server will ignore it */
  addfunctionname?: boolean;
  /** Custom URL marker */
  urlappend?: string;
  /** Call timeout */
  timeout?: number;
  /** Abort signal to cancel the RPC */
  signal?: AbortSignal;
  /** Retry on 429 */
  retry429?: boolean;
  /** Debug (Follows 'rpc' debugflag if not explicity specified) */
  debug?: boolean;
  /** Wrap result with response info */
  wrapresult?: boolean;
  keepalive?: boolean;
}

function getDebugAppend() {
  if (typeof window !== "undefined" && typeof window.location !== "undefined") {
    const urldebugvar = new URL(window.location.href).searchParams.get("wh-debug");
    if (urldebugvar)
      return '?wh-debug=' + encodeURIComponent(urldebugvar);
  }
  return '';
}

type Stack = unknown;

/* this is the followup for net/jsonrpc.es - we can hopefully clear net/ someday
   and move net/eventserver to wh/eventserver.es then */

class ControlledCall {
  client: RPCClient;
  options: RPCCallOptions;
  abortcontroller: AbortController;
  timeout?: number;
  _callurl: string;
  _fetchoptions: RequestInit;
  promise: Promise<unknown>;
  timedout?: boolean;
  aborted?: boolean;

  constructor(client: RPCClient, method: string, stack: Stack, id: number, options: RPCCallOptions, callurl: string, fetchoptions: RequestInit) {
    this.client = client;
    this.options = options;

    // if(options.timeout || options.signal) //as long as rpcResolve exists, we'll ALWAYS need to setup a controller
    {
      this.abortcontroller = new AbortController;
      fetchoptions.signal = this.abortcontroller.signal;

      if (options.timeout && options.timeout > 0) {
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
    this.promise = this._completeCall(method, stack, id, fetchpromise) as Promise<unknown>;
  }
  _handleTimeout() {
    this.timedout = true;
    this.abortcontroller.abort();
  }
  _abort() {
    this.aborted = true;
    this.abortcontroller.abort();
  }

  async _completeCall(method: string, stack: Stack, id: number, fetchpromise: Promise<Response>) {
    let response;
    try {
      for (; ;) { //loop to handle "429 Conflict"s
        response = await fetchpromise;
        if (response.status == 429 && !("retry429" in this.options && !this.options.retry429) && response.headers.get("Retry-After")) {
          const retryafter = parseInt(response.headers.get("Retry-After") || "");
          if (this.client.debug)
            console.warn(`[rpc] We are being throttled (429 Too Many Requests) - retrying after ${retryafter} seconds`);

          await new Promise(resolve => setTimeout(resolve, retryafter * 1000));
          fetchpromise = fetch(this._callurl, this._fetchoptions);
          continue;
        }
        break;
      }
    } catch (exception) {
      if (this.client.debug)
        console.log(`[rpc] #${id} Exception invoking '${method}'`, exception);

      if (this.aborted)
        throw new Error(`RPC Aborted`);
      else if (this.timedout)
        throw new Error(`RPC Timeout: timeout was set to ${this.timeout} milliseconds`);
      else
        throw new Error(`RPC Failed: exception: ` + exception);
    }

    let jsonresponse;
    try {
      jsonresponse = await response.json();
      if (this.client.debug)
        console.log(`[rpc] #${id} Received response to '${method}'`, jsonresponse);
    } catch (exception) {
      if (this.client.debug)
        console.warn(`[rpc] #${id} Response was not valid JSON`, exception);
    }

    if (!jsonresponse)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    if (jsonresponse && jsonresponse.error) {
      this.client._tryLogError(stack, jsonresponse.error);
      throw new Error("RPC Error: " + (jsonresponse.error.message || "Unknown error"));
    }

    if (response.status == 200 && jsonresponse && jsonresponse.id !== id)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    if (this.options.wrapresult) {
      return {
        status: response.status,
        result: jsonresponse.result || null,
        error: jsonresponse.error || null,
        retryafter: response.headers.get("Retry-After") ? parseInt(response.headers.get("Retry-After") || "") : null
      };
    }

    return jsonresponse.result;
  }
}

/** Invokes (WebHare) JSON/RPC
    @param url - URL to invoke (leave empty or pass no parameters at all to callback to the current page)
    */
class RPCClient {
  url: string;
  addfunctionname: boolean;
  urlappend: string;
  options: RPCCallOptions;
  whservicematch: RegExpMatchArray | null;

  constructor(url: string, options?: RPCCallOptions) {
    this.options = {
      timeout: 0,
      debug: false,
      ...options
    };

    if (!url)
      throw new Error(`You must specify either a WebHare service name or a full URL`);

    this.url = url;
    this.whservicematch = this.url.match(/^([a-z0-9_]+):([a-z0-9_]+)$/);
    //if shorthand syntax is used, we know we're talking to our local webhare. add function names and the profiling flag if needed
    this.addfunctionname = this.options.addfunctionname !== undefined ? this.options.addfunctionname : Boolean(this.whservicematch);
    this.urlappend = this.options.urlappend !== undefined ? this.options.urlappend : this.whservicematch ? getDebugAppend() : "";
  }

  get debug() {
    return this.options.debug || env.flags.rpc;
  }

  setOptions(options: RPCCallOptions) {
    this.options = { ...this.options, ...options };
  }

  _tryLogError(stack: Stack, error: { data: { trace: unknown; list: unknown }; message: string }) {
    //@ts-ignore TODO figure out proper signatures for stack/errors
    const trace: Array<{ filename: string; line: number; col: number; func: string }> = error.data ? (error.data.trace || error.data.list || []) : [];

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

  //calculate the final URL. delayed here so services can be created on import (getDefaultRPCBase may require waiting for service.ready)
  private getURL() {
    if (this.whservicematch)
      return `${env.getDefaultRPCBase()}wh_services/${this.whservicematch[1]}/${this.whservicematch[2]}`;
    else
      return this.url;
  }

  invoke(method: string, params: unknown[]) {
    //build the URL, add profiling and function parameters where needed
    let callurl = this.getURL();
    if (this.addfunctionname) //simplifies log analysis, ignored by the server
      callurl += `/${method}`;
    callurl += this.urlappend;

    const id = ++globalseqnr;
    let stack;

    if (this.debug) {
      stack = new Error().stack;
      console.log(`[rpc] #${id} Invoking '${method}'`, params, callurl);
    }

    const fetchoptions: RequestInit = {
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
      keepalive: Boolean(this.options.keepalive)
    };

    return new ControlledCall(this, method, stack, id, this.options, callurl, fetchoptions).promise;
  }
}

type ServiceBase<T> =
  {
    withOptions(options: RPCCallOptions): T;
  };

class ServiceProxy<T> {
  client: RPCClient;

  constructor(client: RPCClient) {
    this.client = client;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (prop === 'withOptions') //create a withOptions function
      return (options: RPCCallOptions) => createClient<T>(this.client.url, { ...this.client.options, ...options });

    return (...args: unknown[]) => this.client.invoke(prop, args);
  }
}

export default function createClient<T>(servicename: string, options?: RPCCallOptions): T & ServiceBase<T> {
  const rpcclient = new RPCClient(servicename, options);
  return new Proxy({}, new ServiceProxy<T>(rpcclient)) as T & ServiceBase<T>;
}
