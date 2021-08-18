import $todd from "@mod-tollium/web/ui/js/support";
import TransportBase from "./transportbase.es";
var JSONRPC = require('@mod-system/js/net/jsonrpc');
import * as whintegration from '@mod-system/js/wh/integration';

/// WebSocket via sharedworker support
export default class SharedWebSocketTransport extends TransportBase
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
}
