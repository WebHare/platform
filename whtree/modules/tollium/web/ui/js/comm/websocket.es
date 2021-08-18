import $todd from "@mod-tollium/web/ui/js/support";
import TransportBase from "./transportbase.es";
// FIXME: websocket transport isn't nearly as error-resilient as shared worker transport
// Should share the reconnect code

/// WebSocket support
export default class WebSocketTransport extends TransportBase
{
  constructor(options)
  {
    super({ commhost: '', ...options });

    this.socket = null;
    this.signalled = [];
    this.sentall = [];
    this.jsonrpc = null;
    this.backoff = 0;

    $todd.DebugTypedLog("rpc", '** create WebSocket transport');
    this.connectWebsocket();
  }

  connectWebsocket()
  {
    let url = (new URL('/.tollium/ui/comm.whsock', location.href)).toString();
    this.socket = new WebSocket('ws' + url.substr(4));
    this.socket.addEventListener('open', e => this.gotOpen(e));
    this.socket.addEventListener('message', e => this.gotMessage(e));
    this.socket.addEventListener("close", e => this.gotClose(e));
    this.socket.addEventListener("error", e => this.gotError(e));
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
    /* Set all endpoints as signalled and reset sendall, so we'll repeat
       all non-acked messages every link, needed for correct link establishment
       in appstarter)
    */
    this.sentall = [];
    this.signalled = this.endpoints;

    // make next reconnection speedy again
    this.backoff = 0;

//    console.log('gotopen');
    this.updateListenLinks();

    this.signalOnline();
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
    if (this.socket)
      this.socket.close();
    this.socket = null;

    let nowbackoff = this.backoff;
    this.backoff = Math.min(this.backoff * 2 || 1, 60);

    if (nowbackoff >= 16) // 15 seconds without a connection
      this.signalOffline();

    console.log(`Websocket closed, need to reconnect in ${nowbackoff} seconds`, event);
    setTimeout(() =>
    {
      console.log(`Reconnecting websocket`);
      this.connectWebsocket();
    }, nowbackoff * 1000);
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
    this.handleSignalledEndpoints();
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
}
