import type { LinkEndpoint, LinkWireMessage } from "./linkendpoint";

import { reportException } from "@mod-system/js/wh/errorreporting";

export interface TransportBaseOptions {
  commurl: string;
  commhost: string;
  onrequestneeded: (() => void) | null;
  onresponse: (() => void) | null;
  ononline: (() => void) | null;
  onoffline: (() => void) | null;
}

export default class TransportBase {
  /** List of endpoints */
  endpoints: LinkEndpoint[] = [];
  options: TransportBaseOptions;
  serializer: Promise<void> = Promise.resolve();
  unloading = false;
  online = false;

  constructor(options?: Partial<TransportBaseOptions>) {
    this.options =
    {
      commurl: '',
      commhost: '',
      onrequestneeded: null,
      onresponse: null,
      ononline: null,
      onoffline: null,
      ...options
    };
  }

  destroy() {
  }

  setSignalled(endpoint: LinkEndpoint) {
  }

  addEndPoint(endpoint: LinkEndpoint) {
    endpoint.transport = this;
    this.endpoints.push(endpoint);
  }

  removeEndPoint(endpoint: LinkEndpoint) {
    endpoint.transport = null;
    this.endpoints = this.endpoints.filter(e => e !== endpoint);
    return this.endpoints.length !== 0;
  }

  /// Called within onunload handler - to push out stuff as quick as possible
  runUnloadHandler() {
  }

  processGotMessageMessage(msg: LinkWireMessage) {
    // Finally process the message _finally to absorb crashes.
    this.serializer = this.serializer.finally(this.processWireMessage.bind(this, msg)).catch(reportException) as Promise<void>;
  }

  processWireMessage(msg: LinkWireMessage) {
    for (let j = 0; j < this.endpoints.length; ++j)
      if (this.endpoints[j].options.linkid === msg.linkid) {
        const endpoint = this.endpoints[j];

        // FIXME trycatch!
        endpoint.processWireMessage(msg);

        if (endpoint.seennewmessage && this.endpoints.includes(endpoint))
          this.gotNewMessage(endpoint);
      }
  }

  // Called when a new message has arrived at an endpoint
  gotNewMessage(endpoint: LinkEndpoint) {
  }

  signalOnline() {
    if (this.online)
      return;

    this.online = true;
    if (this.options.ononline)
      this.options.ononline();
  }

  signalOffline() {
    if (!this.online)
      return;

    this.online = false;
    if (this.options.onoffline)
      this.options.onoffline();
  }
}
