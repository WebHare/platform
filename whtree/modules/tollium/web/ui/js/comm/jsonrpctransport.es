var $todd = require("../support");
import TransportBase from "./transportbase.es";
var JSONRPC = require('@mod-system/js/net/jsonrpc');
import * as whintegration from '@mod-system/js/wh/integration';

/// JSONRPC support
export default class JSONRPCTransport extends TransportBase
{
  constructor(options)
  {
    super({ commhost: '', ...options });

    this.jsonrpc = null;
    this.request = null;
    this.scheduled = false;
    this.unloading = false;
  //  , sendallmessages: true

    this.fails = 0;
    this.online = false;

    $todd.DebugTypedLog("rpc", '** create JSONRPC transport');

    this.jsonrpc = new JSONRPC(
      { url: whintegration.config.obj.toddservice
      , appendfunctionname: true
      , log: $todd.IsDebugTypeEnabled('rpc')
      });

    setTimeout(() => this.startRequest(), 1);
    this.scheduled = true;
  }

  destroy()
  {
    if (this.jsonrpc)
      this.jsonrpc.destroy();
    this.jsonrpc = null;
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

  startRequest()
  {
    if (!this.jsonrpc)
      return;

    if (this.request)
    {
      $todd.DebugTypedLog("rpc", '** JSONRPC cancel current request');
      this.request.cancel();
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

    // Synchronous request when we're unloading for our very last message. Lower the timeout somewhat then.
    this.request = this.jsonrpc.request('RunToddComm',
                                        [ req ],
                                        this.gotSuccess.bind(this),
                                        this.gotFailure.bind(this),
                                        { timeout: this.unloading ? 500 : 300000
                                        , synchronous: this.unloading && !$todd.fastunload
                                        });
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
