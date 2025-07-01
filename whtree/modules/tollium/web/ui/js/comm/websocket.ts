import * as $todd from "@mod-tollium/web/ui/js/support";
import TransportBase, { type TransportBaseOptions } from "./transportbase";
import type { LinkEndpoint } from "./linkendpoint";

/// WebSocket support
export default class WebSocketTransport extends TransportBase {
  signalled: LinkEndpoint[] = [];
  socket: WebSocket | null = null;
  sentall: LinkEndpoint[] = [];
  backoff = 0;

  constructor(options?: Partial<TransportBaseOptions>) {
    super(options);

    $todd.DebugTypedLog("rpc", '** create WebSocket transport');
    this.connectWebsocket();
  }

  connectWebsocket() {
    const url = (new URL('/.tollium/ui/comm.whsock', location.href)).toString();
    this.socket = new WebSocket('ws' + url.substr(4));
    this.socket.addEventListener('open', () => this.gotOpen());
    this.socket.addEventListener('message', e => this.gotMessage(e));
    this.socket.addEventListener("close", e => this.gotClose(e));
    this.socket.addEventListener("error", e => this.gotError(e));
  }

  destroy() {
    if (this.socket)
      this.socket.close();
    this.socket = null;
  }

  addEndPoint(endpoint: LinkEndpoint) {
    super.addEndPoint(endpoint);
    this.updateListenLinks();
  }

  removeEndPoint(endpoint: LinkEndpoint) {
    const res = super.removeEndPoint(endpoint);
    this.updateListenLinks();

    this.signalled = this.signalled.filter(e => e !== endpoint);
    this.sentall = this.sentall.filter(e => e !== endpoint);

    return res;
  }

  gotOpen() {
    /* Set all endpoints as signalled and reset sendall, so we'll repeat
       all non-acked messages every link, needed for correct link establishment
       in appstarter)
    */
    this.sentall = [];
    this.signalled = this.endpoints;

    //    console.log('gotopen');
    this.updateListenLinks();

    this.signalOnline();
  }

  gotMessage(message: MessageEvent) {
    const rawmsg = JSON.parse(message.data);
    for (let i = 0; i < rawmsg.msg.data.length; ++i) {
      const msg = rawmsg.msg.data[i];
      this.processGotMessageMessage(msg);
    }

    // once the connection is actually sending messages, make next reconnection speedy again (don't reset backoff in a close/open loop)
    this.backoff = 0;
  }

  gotError(event: Event) {
    console.error("Websocket error", event);
  }

  gotClose(event: Event) {
    if (this.socket)
      this.socket.close();
    this.socket = null;

    const nowbackoff = this.backoff;
    this.backoff = Math.min((this.backoff * 2) || 1, 60);

    if (nowbackoff >= 16) // 15 seconds without a connection
      this.signalOffline();

    console.log(`Websocket closed, need to reconnect in ${nowbackoff} seconds`, event);
    setTimeout(() => {
      console.log(`Reconnecting websocket`);
      this.connectWebsocket();
    }, nowbackoff * 1000);
  }

  setSignalled(endpoint: LinkEndpoint) {
    //    console.log('endpoint signalled', endpoint.options.linkid, this.socket ? this.socket.readyState : 'n/a');
    if (!this.signalled.includes(endpoint))
      this.signalled.push(endpoint);
    if (this.socket && this.socket.readyState === WebSocket.OPEN)
      this.handleSignalledEndpoints();
  }

  updateListenLinks() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return;

    const links: string[] = [];
    const frontendids: string[] = [];
    this.endpoints.forEach(function (endpoint) {
      if (!links.includes(endpoint.options.linkid))
        links.push(endpoint.options.linkid);
      if (!frontendids.includes(endpoint.options.frontendid))
        frontendids.push(endpoint.options.frontendid);
    });

    this.socket.send(JSON.stringify({ requests: [{ type: 'listen', links: links, frontendids: frontendids }] }));
    this.handleSignalledEndpoints();
  }

  handleSignalledEndpoints() {
    //console.log('handleSignalledEndpoints');
    for (let i = 0; i < this.signalled.length; ++i) {
      const endpoint = this.signalled[i];
      //console.log(' handle signalled endpoint', endpoint.options.linkid);

      const sentall = this.sentall.includes(endpoint);
      const msg = endpoint.constructWireMessage(!sentall);
      this.socket!.send(JSON.stringify({ requests: [{ type: 'msg', msg: msg }] }));
      if (!sentall)
        this.sentall.push(endpoint);
    }

    this.signalled = [];
  }

  // Called when a new message has arrived at an endpoint
  gotNewMessage(endpoint: LinkEndpoint) {
    // Immediately send an ack
    if (!this.signalled.includes(endpoint))
      this.signalled.push(endpoint);
    this.handleSignalledEndpoints();
  }
}
