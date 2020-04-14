import * as dompack from 'dompack';

//just number RPCs globally instead of per server, makes debug ouput more useful
let globalseqnr = 1;

function getDebugAppend()
{
  let urldebugvar = window.location.href.match(new RegExp('[?&#]wh-debug=([^&#?]*)'));
  return urldebugvar ? '?wh-debug='+urldebugvar[1] : '';
}

/* this is the followup for net/jsonrpc.es - we can hopefully clear net/ someday
   and move net/eventserver to wh/eventserver.es then */

class ControlledCall
{
  constructor(client, method, stack, id, options, callurl, fetchoptions)
  {
    this.client = client;
    this.options = options;


    // if(options.timeout || options.signal) //as long as rpcResolve exists, we'll ALWAYS need to setup a controller
    {
      this.abortcontroller = new AbortController;
      fetchoptions.signal = this.abortcontroller.signal;

      if(options.timeout > 0)
      {
        this.timeout = options.timeout;
        setTimeout(() => this._handleTimeout(), options.timeout);
      }
      if(options.signal)
      {
        options.signal.addEventListener("abort", () => this._abort());
      }
    }

    let fetchpromise = fetch(callurl, fetchoptions);

    this.promise = this._completeCall(method, stack, id, fetchpromise);
    this.promise.__jsonrpcinfo = this;
  }
  _handleTimeout()
  {
    this.timedout = true;
    this.abortcontroller.abort();
  }
  _abort()
  {
    this.aborted = true;
    this.abortcontroller.abort();
  }
  _legacyResolve(resolution)
  {
    this.legacyresolve = resolution;
    this.abortcontroller.abort();
  }
  async _completeCall(method, stack, id, fetchpromise)
  {
    let response;
    try
    {
      response = await fetchpromise;
    }
    catch(exception)
    {
      if(this.options.debug)
        console.log(`[rpc] #${id} Exception invoking '${method}'`, exception);

      if(this.aborted)
        throw new Error(`RPC Aborted`);
      else if(this.timedout)
        throw new Error(`RPC Timeout: timeout was set to ${this.timeout} milliseconds`);
      else if(this.legacyresolve && this.legacyresolve.resolve)
        return this.legacyresolve.resolve;
      else
        throw new Error(`RPC Failed: exception: ` + exception);
    }

    let jsonresponse;
    try
    {
      jsonresponse = await response.json();
      if(this.options.debug)
        console.log(`[rpc] #${id} Received response to '${method}'`, jsonresponse);
    }
    catch(exception)
    {
      if(this.options.debug)
        console.warn(`[rpc] #${id} Response was not valid JSON`, exception);
    }

    if(!jsonresponse)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    if(jsonresponse && jsonresponse.error)
    {
      this.client._tryLogError(stack, jsonresponse.error);
      throw new Error("RPC Error: " + (jsonresponse.error.message || "Unknown error"));
    }

    if(response.status == 200 && jsonresponse && jsonresponse.id !== id)
      throw new Error("RPC Failed: Invalid JSON/RPC response received");

    return jsonresponse.result;
  }
}

/** Invokes (WebHare) JSON/RPC
    @param url URL to invoke (leave empty or pass no parameters at all to callback to the current page)
    @cell options.timeout Default timeout for all calls
    @cell options.debug Debug (Follows 'rpc' debugflag if not explicity specified) */
export default class RPCClient
{
  constructor(url, options)
  {
    this.options = { timeout: 0
                   , debug: dompack.debugflags.rpc
                   , ...options
                   };

    let whservicematch;
    if(url)
    {
      whservicematch = url.match(/^([a-z0-9_]+):([a-z0-9_]+)$/);
      if(whservicematch)
        this.url = `${location.origin}/wh_services/${whservicematch[1]}/${whservicematch[2]}`;
      else
        this.url = url;
    }
    else
    {
      this.url = "";  //invoke ourselves directly if no path specified
    }

    //if shorthand syntax is used, we know we're talking to our local webhare. add function names and the profiling flag if needed
    this.addfunctionname = this.options.addfunctionname !== undefined ? this.options.addfunctionname : !!whservicematch;
    this.urlappend = this.options.urlappend !== undefined ? this.options.urlappend : whservicematch ? getDebugAppend() : "";
  }

  setOptions(options)
  {
    this.options = {...this.options, ...options};
  }

  _handleLegacyRPCResolve(promise, result)
  {
    if(!promise.__jsonrpcinfo)
      throw new Error("The promise is not an async JSONRPC request");
    promise.__jsonrpcinfo._legacyResolve({resolve:result});
  }

  _tryLogError(stack,error)
  {
    let trace = error.data ? (error.data.trace || error.data.list || []) : [];

    console.group();
    console.warn("RPC failed:", error.message);
    trace.forEach(rec =>
    {
      if (rec.filename || rec.line)
      {
        var line = rec.filename + '#' + rec.line + '#' + rec.col + (rec.func ? ' (' + rec.func + ')' : '');
        console.log(line);
      }
    });
    if(stack)
    {
      console.warn("Stack at calling point");
      console.log(stack);
    }
    console.groupEnd();
  }

  invoke(...params)
  {
    let options;
    if(typeof params[0] == "object")
      options = {...this.options, ...params.shift()};
    else
      options = this.options;

    let method = params.shift();

    //build the URL, add profiling and function parameters where needed
    let callurl = this.url;
    if(this.addfunctionname) //simplifies log analysis, ignored by the server
      callurl += `/${method}`;
    callurl += this.urlappend;

    let id = ++globalseqnr;
    let stack;

    if(options.debug)
    {
      stack = new Error().stack;
      console.log(`[rpc] #${id} Invoking '${method}'`, params, callurl);
    }

    let fetchoptions = { method: "POST"
                       , headers: { "Accept": "application/json"
                                  , "Content-Type": "application/json; charset=utf-8"
                                  }
                       , body: JSON.stringify(
                                   { id: id
                                   , method: method
                                   , params: params || []
                                   })
                       };

    return new ControlledCall(this, method, stack, id, options, callurl, fetchoptions).promise;
  }
}
