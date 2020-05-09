var $todd = require("../support");
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
}
