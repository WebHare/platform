var $todd = require("./support");
var JSONRPC = require('@mod-system/js/net/jsonrpc');
var utilerror = require('@mod-system/js/wh/errorreporting');
import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import * as whintegration from '@mod-system/js/wh/integration';

/****************************************************************************************************************************
 * NG communication code
 */

/** Implements the todd end of a reliable communication link
*/
class LinkEndpoint
{ // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(options)
  {
  // Current sequence nr for messages
    this.msgcounter = 0;

    // List of meessages (unacked & unsent)
    this.queuedmessages = [];

    // Don't transmit immediately
    this.stoptransmit = false;

    // Seqnr of last message sent over the wire
    this.lastsentseqnr = 0;

    // Seqnr of last (correctly) received message
    this.lastreceivedseqnr = 0;

    // Linked TransportManager
    this.transmgr = null;

    // Transport (used by TransportManager)
    this.transport = null;

    // Set to true when a new message was seen since the last constructed wire message
    this.seennewmessage = false;

    // Current online status
    this.online = false;

    // options
    this.options =
        { linkid:  ''
        , commhost: ''
        , frontendid: ''
        , ...options
        };

    //console.log('** new endpoint', this.options.linkid, this.options.frontendid, this.options.commhost);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  /* Processes incoming wire message
     @return Whether all messages were sent
  */
  processWireMessage(wiremsg)
  {
    //console.log('** wire msg', wiremsg);

    if (wiremsg.status == "gone")
    {
//      console.log('** link closed - unregistering');
      if (this.onclosed && this.transmgr)
        this.onclosed();
      this.unregister();
      return true;
    }

    // Remove ack'ed messages
    let i = 0;
    for (; i < this.queuedmessages.length; ++i)
      if (this.queuedmessages[i].seqnr > wiremsg.ack)
        break;

    // Dispatch all messages we haven't received yet
    this.queuedmessages.splice(0, i);

    for (i = 0; i < wiremsg.messages.length; ++i)
    {
      //console.log('dispatch message', this.options.linkid, wiremsg.messages[i].seqnr, this.lastreceivedseqnr + 1);
      if (wiremsg.messages[i].seqnr == this.lastreceivedseqnr + 1)
      {
        // Mark as received first, processing the message can throw...
        ++this.lastreceivedseqnr;
        this.seennewmessage = true;

        //console.log('onmessage');
        this.onmessage(wiremsg.messages[i].data);

      }
    }

    return this.queuedmessages.length == 0;
  }

  constructWireMessage(sendall)
  {
    var startmsgpos = 0;
    if (!sendall)
      for (; startmsgpos < this.queuedmessages.length; ++startmsgpos)
        if (this.queuedmessages[startmsgpos].seqnr > this.lastsentseqnr)
          break;

    this.lastsentseqnr = this.msgcounter;
    var wiremsg =
        { linkid: this.options.linkid
        , messages: this.queuedmessages.slice(startmsgpos)
        , ack: this.lastreceivedseqnr
        , frontendid: this.options.frontendid
        , needack: this.queuedmessages.length != 0
        };

    this.seennewmessage = false;
    return wiremsg;
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Register this endpoint with a communicationManager
  register(transmgr)
  {
    this.transmgr = transmgr;
    this.transmgr.register(this);
    // Automatically signalled
  }

  /// Unregister the endpoint
  unregister()
  {
    if (this.transmgr)
      this.transmgr.unregister(this);
    this.transmgr = null;
    this.queuedmessages=[];
  }

  /// Queue a new message. Returns the message nr (which is monotonically increasing in time)
  queueMessage(message)
  {
    $todd.DebugTypedLog("rpc", '** QUEUE MESSAGE',message);
    this.queuedmessages.push({ seqnr: ++this.msgcounter, data: message });

    if (!this.stoptransmit && this.transport)
      this.transport.setSignalled(this);

    return this.msgcounter;
  }

  /** Indicate that messages have been received through another channel. Pass the seqnr of the last message.
      Use this when initial messages are transferred by service call before setting up the comm channel.
  */
  registerManuallyReceivedMessage(seqnr)
  {
    //console.log('registerManuallyReceivedMessage', seqnr);
    this.lastreceivedseqnr = seqnr;
  }
};

/** The transportManager handles setting up transports for the endpoints
*/
class TransportManager
{ // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(options)
  {
    /* List of registered endpoints
        @cell linkid
        @cell endpoint
        @cell transport
    */
    this.endpoints = [];

    /* List of registered transports
        @cell endpoints Registered endpoints
        @cell commurl Communication url
        @cell trans Transport object
    */
    this.transports = [];

    this.options =
      { ononline:   null
      , onoffline:  null
      , ...options
      };
  }

  // ---------------------------------------------------------------------------
  //
  // Endpoint internal API
  //

  /** Registers an endpoint
  */
  register(endpoint)
  {
    var commhost = endpoint.options.commhost;

    var transport = null;
    for (var i = 0; i < this.transports.length; ++i)
      if (this.transports[i].options.commhost == commhost)
        transport = this.transports[i];

    if (!transport)
    {
      if (!$todd.commfallback
          && window.SharedWorker && window.WebSocket
          && !dompack.debugflags.websocket
          && !(['ie','edge'].includes(browser.getName()))) //we prefer to treat Edge as an IE11 because noone tests these workers
      {
        console.log('Using WebSocket transport via sharedworker');
        transport = new SharedWebSocketTransport(
            { commhost: commhost
            , ononline: () => this._gotOnline()
            , onoffline: () => this._gotOffline()
            });
      }
      else if (!$todd.commfallback && window.WebSocket && dompack.debugflags.websocket)
      {
        // Doesn't seem to work on Firefox, some problems with cookies?
        console.warn('Using WebSocket transport'); // FIXME: websocket transport isn't nearly as error-resilient as shared worker transport
        transport = new WebSocketTransport(
            { commhost: commhost
            });
      }
      else
      {
        console.warn('Using fallback (JSONRPC) transport');
        transport = new JSONRPCTransport(
            { commhost: commhost
            , ononline: () => this._gotOnline()
            , onoffline: () => this._gotOffline()
            });
      }

      this.transports.push(transport);
    }

    this.endpoints.push(endpoint);

    //console.log('** register endpoint ', endpoint, 'set transport to', transport);
    transport.addEndPoint(endpoint);

    transport.setSignalled(endpoint);
  }

  /** Unregisters an endpoint
  */
  unregister(endpoint)
  {
    console.log('unregistering endpoint frontendid:', endpoint.options.frontendid || "-", "linkid:", endpoint.options.linkid || "-", this.endpoints.length, endpoint.transport.endpoints.length);
    this.endpoints = this.endpoints.filter(e => e != endpoint);
    if (endpoint.transport)
    {
      var transport = endpoint.transport;
      if (!transport.removeEndPoint(endpoint))
      {
        transport.destroy();
        this.transports = this.transports.filter(e => e != transport);
      }
      console.log('unregistered endpoint', this.endpoints.length, transport.endpoints.length);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _gotOnline(event)
  {
    if (this.options.ononline)
      this.options.ononline();
  }

  _gotOffline(event)
  {
    if (this.options.onoffline)
      this.options.onoffline();
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Signal shutdown
  prepareForUnload()
  {
    this.transports.forEach(function(item){ item.unloading = true; });
  }

  /// Signal shutdown
  executeUnload()
  {
    // Send the dying message (cancel any pending requests). IE 11 doesn't cancel them within iframe
    // which the tests don't like
//    console.log('startRequest for transports ', this.transports.length);
    this.transports.forEach(function(item){ item.runUnloadHandler(); });
  }

  /// Release all resources
  destroy()
  {
    this.transports.forEach(function(item){item.destroy();});
    this.endpoints = [];
    this.transports = [];
  }
};

class TransportBase
{ constructor(options)
  {
    this.serializer = null;

    /// List of endpoints
    this.endpoints = [];

    this.options =
        { commurl:          ''
        , onrequestneeded:  null
        , onresponse:       null
        , ononline:         null
        , onoffline:        null
        , ...options
        };

    this.serializer = Promise.resolve();
  }

  destroy()
  {
  }

  setSignalled(endpoint)
  {
  }

  addEndPoint(endpoint)
  {
    endpoint.transport = this;
    this.endpoints.push(endpoint);
  }

  removeEndPoint(endpoint)
  {
    endpoint.transport = null;
    this.endpoints = this.endpoints.filter(e => e != endpoint);
    return this.endpoints.length != 0;
  }

  /// Called within onunload handler - to push out stuff as quick as possible
  runUnloadHandler()
  {
  }

  processGotMessageMessage(msg)
  {
    // Finally process the message _finally to absorb crashes.
    this.serializer = this.serializer.finally(this.processWireMessage.bind(this, msg)).catch(utilerror.reportException);
  }

  processWireMessage(msg)
  {
    for (var j = 0; j < this.endpoints.length; ++j)
      if (this.endpoints[j].options.linkid == msg.linkid)
      {
        var endpoint = this.endpoints[j];

        // FIXME trycatch!
        endpoint.processWireMessage(msg);

        if (endpoint.seennewmessage && this.endpoints.includes(endpoint))
          this.gotNewMessage(endpoint);
      }
  }

  // Called when a new message has arrived at an endpoint
  gotNewMessage(endpoint)
  {
  }

  signalOnline()
  {
    if(this.online)
      return;

    this.online=true;
    if (this.options.ononline)
      this.options.ononline();
  }

  signalOffline()
  {
    if(!this.online)
      return;

    this.online=false;
    if (this.options.onoffline)
      this.options.onoffline();
  }
};


/// JSONRPC support
class JSONRPCTransport extends TransportBase
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
};

// FIXME: websocket transport isn't nearly as error-resilient as shared worker transport
// Should share the reconnect code

/// WebSocket support
class WebSocketTransport extends TransportBase
{
  constructor(options)
  {
    super({ commhost: '', ...options });

    this.socket = null;
    this.signalled = [];
    this.sentall = [];
    this.jsonrpc = null;

    $todd.DebugTypedLog("rpc", '** create WebSocket transport');

    let url = (new URL('/.tollium/ui/comm.whsock', location.href)).toString();
    this.socket = new WebSocket('ws' + url.substr(4));
    this.socket.addEventListener('open', this.gotOpen.bind(this));
    this.socket.addEventListener('message', this.gotMessage.bind(this));
    this.socket.addEventListener("close", e => this.gotClose(e));
    this.socket.addEventListener("error", e => this.gotError(e));

    this.scheduled = true;
  }

  destroy()
  {
    if (this.socket)
      this.socket.close();
    this.socket = null;
  }

  addEndPoint(endpoint)
  {
    super.addEndPoint(endpoint);
    this.updateListenLinks();
  }

  removeEndPoint(endpoint)
  {
    var res = super.removeEndPoint(endpoint);
    this.updateListenLinks();

    this.signalled = this.signalled.filter(e => e != endpoint);
    this.sentall = this.sentall.filter(e => e != endpoint);

    return res;
  }

  gotOpen()
  {
//    console.log('gotopen');
    this.updateListenLinks();
  }

  gotMessage(message)
  {
    var rawmsg = JSON.parse(message.data);
    for (var i = 0; i < rawmsg.msg.data.length; ++i)
    {
      var msg = rawmsg.msg.data[i];
      this.processGotMessageMessage(msg);
    }
  }

  gotError(event)
  {
    console.error("Websocket error", event);
  }
  gotClose(event)
  {
    console.error("Websocket close", event);
  }

  setSignalled(endpoint)
  {
//    console.log('endpoint signalled', endpoint.options.linkid, this.socket ? this.socket.readyState : 'n/a');
    if (!this.signalled.includes(endpoint))
      this.signalled.push(endpoint);
    if (this.socket && this.socket.readyState == 1)
      this.handleSignalledEndpoints();
  }

  updateListenLinks()
  {
    if (!this.socket || this.socket.readyState != 1)
      return;

    var links = [];
    var frontendids = [];

    this.endpoints.forEach(function(endpoint)
      {
        if (!links.includes(endpoint.options.linkid))
          links.push(endpoint.options.linkid);
        if (!frontendids.includes(endpoint.options.frontendid))
          frontendids.push(endpoint.options.frontendid);
      });

    this.socket.send(JSON.stringify({ requests: [ { type: 'listen', links: links, frontendids: frontendids } ] }));
  }

  handleSignalledEndpoints()
  {
    //console.log('handleSignalledEndpoints');
    for (var i = 0; i < this.signalled.length; ++i)
    {
      var endpoint = this.signalled[i];
      //console.log(' handle signalled endpoint', endpoint.options.linkid);

      var sentall = this.sentall.includes(endpoint);
      var msg = endpoint.constructWireMessage(!sentall);
      this.socket.send(JSON.stringify({ requests: [ { type: 'msg', msg: msg } ] }));
      if (!sentall)
        this.sentall.push(endpoint);
    }

    this.signalled = [];
  }
};

/// WebSocket via sharedworker support
class SharedWebSocketTransport extends TransportBase
{
  constructor(options)
  {
    super({ commhost: '', ...options });

    this.worker = null;
    this.signalled = [];
    this.sentall = [];
    this.toack = [];

    this.timeoutctr = 0;
    this.timeout = null;

    this.jsonrpc = null;

    // Init JSON RPC for cookies FIXME still needed?
    this.jsonrpc = new JSONRPC(
      { url: whintegration.config.obj.toddservice
      , appendfunctionname: true
      , log: $todd.IsDebugTypeEnabled('rpc')
      });

    this._initWorker(true);
  }

  destroy()
  {
    this.signalled = [];
    this.sentall = [];
    this.toack = [];
    this._updateAckTimeout();
    if (this.timeout)
      clearTimeout(this.timeout);

    this._closeWorker();
  }


  _initWorker(firststart)
  {
    $todd.DebugTypedLog("rpc", '** create WebSocket transport');

    if (this.worker)
      this._closeWorker();

    this.worker = new SharedWorker(whintegration.config.obj.sharedworker);
    this.worker.onerror = this._gotWorkerError.bind(this);
    this.worker.port.onmessage = this._gotMessage.bind(this);
    this.worker.port.postMessage({ type: 'tollium-ws-openconnection', firststart: firststart });

    if (!this.timeout)
      this.timeout = setTimeout(() => this._gotTimeout(), 7000);
  }

  _closeWorker()
  {
    if (this.worker)
    {
      this.worker.port.postMessage({ type: 'close' });
      this.worker.port.close();
    }
    this.worker = null;
  }

  _gotMessage(event)
  {
    this.timeoutctr = 0;

    $todd.DebugTypedLog("rpc", 'shared worker message:', event.data);

    switch (event.data.type)
    {
      case 'online':
      {
        this.signalOnline();
        this._handleReconnect();
      } break;
      case 'offline':
      {
        // We're disconnected for now. FIXME: what to do?
        this.sentall = [];
        this.signalOffline();
      } break;
      case 'message':
      {
        var msg = event.data.data;
        this.processGotMessageMessage(msg);
      } break;
      case 'ping':
      {
        if (this.worker)
          this.worker.port.postMessage({ type: 'pong', msg: "responding at " + new Date().getTime() });

        if (this.timeout)
        {
          clearTimeout(this.timeout);
          this.timeout = setTimeout(() => this._gotTimeout(), 7000);
        }
      } break;
      case "close":
      {
        console.log("Got close message, shared worker has terminated the connection");

        // We're disconnected for now.
        this.sentall = [];
        this.signalOffline();

        // Reinit the worker
        this._initWorker(false);
      }
    }
  }

  _gotWorkerError(error)
  {
    console.warn('shared worker error:', error);
    $todd.DebugTypedLog("rpc", 'shared worker error:',error);
  }

  _gotTimeout()
  {
    this.timeout = null;
    if (++this.timeoutctr >= 2)
    {
      console.warn("Too many timeouts, assuming worker is has terminated");

      this.sentall = [];

      setTimeout(() => this._initWorker(false), 1000);
      this.signalOffline();
    }
    else
      this.timeout = setTimeout(() => this._gotTimeout(), 6000);
  }

  _updateListenLinks()
  {
    if (!this.worker || !this.online)
      return;

    var links = [];
    var frontendids = [];

    this.endpoints.forEach(endpoint =>
    {
      if (!links.includes(endpoint.options.linkid))
        links.push(endpoint.options.linkid);
      if (!frontendids.includes(endpoint.options.frontendid))
        frontendids.push(endpoint.options.frontendid);
    });

    this.worker.port.postMessage({ type: 'tollium-ws-setlistenlinks', links: links, frontendids: frontendids });
  }

  _handleSignalledEndpoints()
  {
    //console.log('handleSignalledEndpoints');
    for (var i = 0; i < this.signalled.length; ++i)
    {
      var endpoint = this.signalled[i];
      $todd.DebugTypedLog("rpc", ' handle signalled endpoint', endpoint.options.linkid);

      var sentall = this.sentall.includes(endpoint);
      var msg = endpoint.constructWireMessage(!sentall);

      this.worker.port.postMessage({ type: 'tollium-ws-sendrequests', requests: [ { type: 'msg', msg: msg } ] });
      if (!sentall)
        this.sentall.push(endpoint);
    }

    this.signalled = [];
    this.toack = [];
    this._updateAckTimeout();
  }

  _handleReconnect()
  {
    // Update listen links
    this._updateListenLinks();

    // Resend for all endpoints
    this.endpoints.forEach(function(endpoint)
    {
      var msg = endpoint.constructWireMessage(true);

      this.worker.port.postMessage({ type: 'tollium-ws-sendrequests', requests: [ { type: 'msg', msg: msg } ] });
      if (!this.sentall.includes(endpoint))
        this.sentall.push(endpoint);
    }.bind(this));

    this.signalled = [];
    this.toack = [];
    this._updateAckTimeout();
  }

  _updateAckTimeout()
  {
    if (!this.toack.length != !this.toack_cb)
    {
      if (this.toack.length)
        this.toack_cb = setTimeout(() => this._sendAcks(), 10000);
      else
      {
        clearTimeout(this.toack_cb);
        this.toack_cb = null;
      }
    }
  }

  _sendAcks()
  {
    for(var toack of this.toack)
      if(!this.signalled.includes(toack))
        this.signalled.push(toack);

    if (this.online)
      this._handleSignalledEndpoints();
  }

  addEndPoint(endpoint)
  {
    super.addEndPoint(endpoint);
    this._updateListenLinks();

    if (!this.timeout)
      this.timeout = setTimeout(() => this._gotTimeout(), 6000);
  }

  removeEndPoint(endpoint)
  {
    var res = super.removeEndPoint(endpoint);
    this._updateListenLinks();

    this.signalled = this.signalled.filter(e => e != endpoint);
    this.sentall = this.sentall.filter(e => e != endpoint);
    this.toack = this.toack.filter(e => e != endpoint);

    if (!res)
    {
      if (this.timeout)
        clearTimeout(this.timeout);
      this.timeout = null;
    }
    return res;
  }

  setSignalled(endpoint)
  {
    //console.log('endpoint signalled', endpoint.options.linkid, this.online ? 'online' : 'offline');
    if (!this.signalled.includes(endpoint))
      this.signalled.push(endpoint);
    if (this.online)
      this._handleSignalledEndpoints();
  }

  gotNewMessage(endpoint)
  {
    if (!this.toack.includes(endpoint))
      this.toack.push(endpoint);
    this._updateAckTimeout();
  }

};

$todd.LinkEndPoint = LinkEndpoint;
$todd.TransportBase = TransportBase;
$todd.TransportManager = TransportManager;
$todd.JSONRPCTransport = JSONRPCTransport;
$todd.SharedWebSocketTransport = SharedWebSocketTransport;
