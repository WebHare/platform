var $todd = require("../support");
import TransportBase from "./transportbase.es";
import * as service from "./toddservice.rpc.json";

/// JSONRPC support
export default class JSONRPCTransport extends TransportBase
{
  constructor(options)
  {
    super({ commhost: '', ...options });

    this.request = null;
    this.request_keepalive = false;
    this.scheduled = false;
    this.unloading = false;
  //  , sendallmessages: true

    this.fails = 0;
    this.online = false;

    $todd.DebugTypedLog("rpc", '** create JSONRPC transport');

    setTimeout(() => this.startRequest(), 1);
    this.scheduled = true;
  }

  destroy()
  {
    if (this.request && !this.request_keepalive)
      this.request.abort();
  }

  setSignalled(endpoint)
  {
    if (!this.scheduled && !this.unloading)
    {
      $todd.DebugTypedLog("rpc", '** JSONRPC scheduling request');
      setTimeout(() => this.startRequest(), 1);
    }
    this.scheduled = true;
  }

  async startRequest()
  {
    if (this.request)
    {
      $todd.DebugTypedLog("rpc", '** JSONRPC cancel current request');
      this.request.abort();
      this.request = null;
    }

    $todd.DebugTypedLog("rpc", '** JSONRPC start new request');
    this.scheduled = false;
    this.running = true;

    var req = { links: [], frontendids: [], unloading: this.unloading };
    for (var i = 0; i < this.endpoints.length; ++i)
    {
      req.links.push(this.endpoints[i].constructWireMessage(true));
      if (!req.frontendids.includes(this.endpoints[i].options.frontendid))
        req.frontendids.push(this.endpoints[i].options.frontendid);
    }

    const abortcontroller = new AbortController;
    this.request = abortcontroller;

    let result;
    try
    {
      this.request_keepalive = this.unloading;

      // use keepalive when unloading, so the request isn't aborted upon unload
      result = await service.invoke(
          { timeout: this.unloading ? 5000 : 300000
          , keepalive: this.unloading
          , signal: abortcontroller.signal
          }, "RunToddComm",
          req);
    }
    catch (e)
    {
      if (!abortcontroller.signal.aborted)
        this.gotFailure(e);
      return;
    }

    this.gotSuccess(result);
  }

  gotSuccess(data)
  {
    $todd.DebugTypedLog("rpc", '** JSONRPC got response', data, this.endpoints);

    this.signalOnline();

    this.fails = 0;

    // Indicate we aren't processing, and schedule the next request before processing messages throws.
    this.request = null;
    this.setSignalled();

    for (var i = 0; i < data.links.length; ++i)
    {
      var msg = data.links[i];
      this.processWireMessage(msg);
    }
  }

  gotFailure(data)
  {
    $todd.DebugTypedLog("rpc", '** JSONRPC got FAILURE', data);

    // Two fails in a row: offline
    if (this.fails)
      this.signalOffline();

    if (++this.fails < 10)
      setTimeout(() => this.startRequest(), 300 * this.fails * this.fails); //exp backoff. first retry will be after 300msec, last attempt (#9) after 30 sec
  }

  runUnloadHandler()
  {
    // If scheduled start request immediately, don't want to wait for any delayed stuff
    if (this.scheduled)
      this.startRequest();
  }
}
