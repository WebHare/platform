import * as $todd from "@mod-tollium/web/ui/js/support";
import TransportBase, { type TransportBaseOptions } from "./transportbase";
import { createClient } from "@webhare/jsonrpc-client";
import type { LinkWireMessage } from "./linkendpoint";
import type { TolliumToddService } from "../types";

/// JSONRPC support
export default class JSONRPCTransport extends TransportBase {
  request: AbortController | null = null;
  request_keepalive = false;
  scheduled = false;
  fails = 0;
  online = false;
  running = false;

  constructor(options: Partial<TransportBaseOptions> = {}) {
    super(options);

    $todd.DebugTypedLog("rpc", '** create JSONRPC transport');

    setTimeout(() => this.startRequest(), 1);
    this.scheduled = true;
  }

  destroy() {
    if (this.request && !this.request_keepalive)
      this.request.abort();
  }

  setSignalled() {
    if (!this.scheduled && !this.unloading) {
      $todd.DebugTypedLog("rpc", '** JSONRPC scheduling request');
      setTimeout(() => this.startRequest(), 1);
    }
    this.scheduled = true;
  }

  async startRequest() {
    if (this.request) {
      $todd.DebugTypedLog("rpc", '** JSONRPC cancel current request');
      this.request.abort();
      this.request = null;
    }

    $todd.DebugTypedLog("rpc", '** JSONRPC start new request');
    this.scheduled = false;
    this.running = true;

    const req = {
      links: [] as LinkWireMessage[],
      frontendids: [] as string[],
      unloading: this.unloading
    };
    for (let i = 0; i < this.endpoints.length; ++i) {
      req.links.push(this.endpoints[i].constructWireMessage(true));
      if (!req.frontendids.includes(this.endpoints[i].options.frontendid))
        req.frontendids.push(this.endpoints[i].options.frontendid);
    }

    if (!req.links.length && !req.frontendids.length) { //no links up anymore, no need to run
      this.running = false;
      return;
    }

    const abortcontroller = new AbortController;
    this.request = abortcontroller;

    let result;
    try {
      this.request_keepalive = this.unloading;

      // use keepalive when unloading, so the request isn't aborted upon unload
      const client = createClient<TolliumToddService>("tollium:todd", {
        timeout: this.unloading ? 5000 : 300000,
        keepalive: this.unloading,
        signal: abortcontroller.signal
      });

      result = await client.runToddComm(req);
    } catch (e) {
      if (!abortcontroller.signal.aborted)
        this.gotFailure(e);
      return;
    }

    this.gotSuccess(result);
  }

  gotSuccess(data: { links: LinkWireMessage[] }) {
    $todd.DebugTypedLog("rpc", '** JSONRPC got response', data, this.endpoints);

    this.signalOnline();

    this.fails = 0;

    // Indicate we aren't processing, and schedule the next request before processing messages throws.
    this.request = null;
    this.setSignalled();

    for (let i = 0; i < data.links.length; ++i) {
      const msg = data.links[i];
      this.processWireMessage(msg);
    }
  }

  gotFailure(data: unknown) {
    $todd.DebugTypedLog("rpc", '** JSONRPC got FAILURE', data);

    // Two fails in a row: offline
    if (this.fails)
      this.signalOffline();

    if (++this.fails < 10)
      setTimeout(() => this.startRequest(), 300 * this.fails * this.fails); //exp backoff. first retry will be after 300msec, last attempt (#9) after 30 sec
  }

  runUnloadHandler() {
    // If scheduled start request immediately, don't want to wait for any delayed stuff
    if (this.scheduled)
      this.startRequest();
  }
}
