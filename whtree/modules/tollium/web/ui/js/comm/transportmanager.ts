/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import JSONRPCTransport from "./jsonrpctransport";
import WebSocketTransport from "./websocket";

/** The transportManager handles setting up transports for the endpoints
*/
export default class TransportManager { // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(options) {
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
    {
      ononline: null,
      onoffline: null,
      ...options
    };
  }

  // ---------------------------------------------------------------------------
  //
  // Endpoint internal API
  //

  suggestTransportType() {
    const urltransporttype = new URL(location.href).searchParams.get("transport");
    return urltransporttype && urltransporttype === "jsonrpc" ? "jsonrpc" : "websocket";
  }

  /** Registers an endpoint
  */
  register(endpoint) {
    const commhost = endpoint.options.commhost;

    let transport = null;
    for (let i = 0; i < this.transports.length; ++i)
      if (this.transports[i].options.commhost === commhost)
        transport = this.transports[i];


    if (!transport) {
      const transporttype = this.suggestTransportType();
      if (transporttype === "websocket") {
        transport = new WebSocketTransport(
          {
            commhost: commhost,
            ononline: () => this._gotOnline(),
            onoffline: () => this._gotOffline()
          });
      } else {
        console.warn('Using fallback (JSONRPC) transport');
        transport = new JSONRPCTransport(
          {
            commhost: commhost,
            ononline: () => this._gotOnline(),
            onoffline: () => this._gotOffline()
          });
      }
      this.transports.push(transport);
    }

    this.endpoints.push(endpoint);
    transport.addEndPoint(endpoint);
    transport.setSignalled(endpoint);
  }

  /** Unregisters an endpoint
  */
  unregister(endpoint) {
    console.log('unregistering endpoint frontendid:', endpoint.options.frontendid || "-", "linkid:", endpoint.options.linkid || "-", this.endpoints.length, endpoint.transport.endpoints.length);
    this.endpoints = this.endpoints.filter(e => e !== endpoint);
    if (endpoint.transport) {
      const transport = endpoint.transport;
      if (!transport.removeEndPoint(endpoint)) {
        transport.destroy();
        this.transports = this.transports.filter(e => e !== transport);
      }
      console.log('unregistered endpoint', this.endpoints.length, transport.endpoints.length);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _gotOnline(event) {
    if (this.options.ononline)
      this.options.ononline();
  }

  _gotOffline(event) {
    if (this.options.onoffline)
      this.options.onoffline();
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Signal shutdown
  prepareForUnload() {
    this.transports.forEach(function (item) { item.unloading = true; });
  }

  /// Signal shutdown
  executeUnload() {
    // Send the dying message (cancel any pending requests). IE 11 doesn't cancel them within iframe
    // which the tests don't like
    //    console.log('startRequest for transports ', this.transports.length);
    this.transports.forEach(function (item) { item.runUnloadHandler(); });
  }

  /// Release all resources
  destroy() {
    this.transports.forEach(function (item) { item.destroy(); });
    this.endpoints = [];
    this.transports = [];
  }
}
