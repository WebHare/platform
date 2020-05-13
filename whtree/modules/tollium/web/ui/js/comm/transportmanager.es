var $todd = require("../support");
import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';

import JSONRPCTransport from "./jsonrpctransport.es";
import WebSocketTransport from "./websocket.es";
import SharedWebSocketTransport from "./sharedwebsocket.es";

/** The transportManager handles setting up transports for the endpoints
*/
export default class TransportManager
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
}
