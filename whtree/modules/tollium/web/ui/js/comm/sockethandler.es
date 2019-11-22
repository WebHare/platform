
import FIFO from "@mod-system/js/internal/util/fifo.es";
import WaitableTimer from "@mod-system/js/internal/util/waitabletimer.es";
import ManualCondition from "@mod-system/js/internal/util/manualcondition.es";

// Websocket alive check control
let pinginterval = 60;
let pongresponsetime = 45;

let debuglog = false;

/** This class implements a FIFO with a wait function that is resolved when an element is present
*/
class SocketHandler
{
  constructor(commurl)
  {
    /// Connection URL
    this._commurl = commurl;
    /// Map with all the registered frontends
    this._frontends = new Map;
    /// List of frontend events (add, close, message, links)
    this._frontendfifo = new FIFO;
    /// Websocket connection to the server
    this._serverconn = null;
    /// Event fifo for the socket connection to the server
    this._serverconneventfifo = null;
    /// Reconnect backoff timer
    this._backofftimer = new WaitableTimer;
    /// Wait timer for pongs
    this._pongtimeout = new WaitableTimer;
    /// Manual condition variable, signalled when there is one or more registered frontends
    this._gotfrontends = new ManualCondition;
    /// Whether connected to the server
    this._isonline = false;
  }

  /// inplace deduplicates an array
  _dedupArray(arr)
  {
    arr.sort();
    return arr.filter((elt, idx, array) => !idx || array[idx - 1] != elt);
  }

  /** Start the connection to a tollium server
  */
  _connectToServer()
  {
    // New event fifo, don't want messages from an old socket
    this._serverconneventfifo = new FIFO;
    this._pongtimeout.reset();

    // Connect to the remote host, push all events into the fifo
    this._serverconn = new WebSocket(this._commurl);
    this._serverconn.addEventListener("open", e => this._serverconneventfifo.push(e));
    this._serverconn.addEventListener("message", e => this._serverconneventfifo.push(e));
    this._serverconn.addEventListener("close", e => this._serverconneventfifo.push(e));
    this._serverconn.addEventListener("error", e => this._serverconneventfifo.push(e));
  }

  /** Send an update to the server with all the links and frontend ids this domain is currently connected to
  */
  _sendListenLinks()
  {
    // Aggregate the links and frontends from the frontends
    let links = [], frontendids = [];

    this._frontends.forEach(data =>
    {
      links = links.concat(data.links);
      frontendids = frontendids.concat(data.frontendids);
    });

    this._dedupArray(links);
    this._dedupArray(frontendids);

    this._sendRequests([ { type: "listen", links: links, frontendids: frontendids } ]);
  }

  /** Sends a list of requests (but only when connected, otherwise the requests are ignored)
      @param requests List of requests
  */
  _sendRequests(requests)
  {
    // Sends requests when we have a server connection, ignore them if there isn't one
    if (this._isonline)
      this._serverconn.send(JSON.stringify({ requests: requests }));
  }

  /** Handles an incoming event form the server connection socket
      @return Whether the connection is still viable. If false, close the connection.
   */
  _handleServerConnectionEvent()
  {
    let e = this._serverconneventfifo.shift();
    switch (e.type)
    {
      case "message":
      {
        this._handleServerMessage(e);
        return true;
      }
      default: // open, error, close
      {
        if (debuglog)
          console.log("Got '" + e.type + "' event from server as connection event");
        return false;
      }
    }
  }

  // Called when a message arives
  _handleServerMessage(message)
  {
    //console.log("got websocket message", message.data);
    var rawmsg = JSON.parse(message.data);

    if (debuglog)
      console.log("got websocket rawmessage for " + this._commurl, rawmsg);

    switch (rawmsg.type)
    {
    case "msg":
      {
        for (var i = 0; i < rawmsg.msg.data.length; ++i)
        {
          var msg = rawmsg.msg.data[i];

          if (debuglog)
            console.log("Got message from the server for link", msg.linkid);

          this._frontends.forEach((data, frontend) =>
          {
            if (data.links.includes(msg.linkid))
              frontend.handleMessage(msg);
          });
        }
      } break;
    case "pong":
      {
        if (debuglog)
          console.log("Received server pong");

        // Cancel the pong timeout
        this._pongtimeout.reset();
      } break;
    }
  }

  /// Sends a ping to the server, setup wait for the pong
  _sendPingToServer()
  {
    this._sendRequests([ { type: "ping" } ]);
    this._pongtimeout.reset(pongresponsetime);
  }

  // Sends the current online status to all the frontends
  _sendStatusMessage(status)
  {
    this._frontends.forEach((data, frontend) =>
    {
      frontend.handleStatusUpdate(this._isonline ? "online" : "offline");
    });
  }

  /// Main running loop
  async run()
  {
    let _backoff = 1;

    while (true)
    {
      /* The shared worker is always opened immediately, but we only need a websocket connectio to the server when the
         user opens an application on the server. So, we wait until there are registered frontends before connecting.
      */
      if (debuglog)
        console.log("Wait for incoming frontends");
      await this._gotfrontends.waitSignalled();

      // Connect the socket. Redirect all events that come in through this websocket into the _serverconneventfifo.
      if (debuglog)
        console.log("Connecting to server");
      this._connectToServer();

      // Wait for initial 'open' event from the server connection
      await this._serverconneventfifo.waitSignalled();
      let e = this._serverconneventfifo.shift();

      if (e.type !== "open")
      {
        if (debuglog)
          console.log("Connection failed, connecting after backoff of ", _backoff, "seconds. Event: ", e);
        // Got an error or a close. set the backoff timer, wait for it to expire
        this._backofftimer.reset(_backoff * 1000);
        await this._backofftimer.waitSignalled();
        _backoff = Math.min(_backoff * 2, 60); // max 60 seconds wait
        continue;
      }

      // Got a connection, reset the backoff timer, inform the endpoints that the connection is live.
      if (debuglog)
        console.log("Connection is open, sending online message to registered links");
      _backoff = 1;
      this._isonline = true;
      this._sendStatusMessage();
      this._sendListenLinks();

      // Send pings every now and then
      let ping = setInterval(() => this._sendPingToServer, pinginterval * 1000);

      while (true)
      {
        // Wait for eventfifo and pong timeout, and for all frontends to have gone away.
        let waitres = await Promise.race(
            [ this._serverconneventfifo.waitSignalled()
            , this._pongtimeout.waitSignalled()
            , this._gotfrontends.waitNotSignalled()
            ]);

        if (waitres === this._gotfrontends)
        {
          // Pong timeout
          if (debuglog)
            console.log("No endpoints active anymore, disconnecting websocket");
          break;
        }
        else if (waitres === this._pongtimeout)
        {
          // Pong timeout
          if (debuglog)
            console.log("Timeout waiting for server response");
          break;
        }
        else if (waitres === this._serverconneventfifo)
        {
          if (!this._handleServerConnectionEvent())
            break;
        }
      }

      this._isonline = false;
      clearInterval(ping);

      this._serverconn.close();
      this._sendStatusMessage();
      this._pongtimeout.reset();
    }
  }

  registerFrontendLink(frontend)
  {
    if (debuglog)
      console.log("Registered new frontend", frontend);
    this._frontends.set(frontend, { links: [], frontendids: [] });
    this._gotfrontends.setSignalled(true);

    if (this._isonline)
      frontend.handleStatusUpdate("online");
  }

  unregisterFrontendLink(frontend)
  {
    if (debuglog)
      console.log("Unregistered frontend", frontend);
    this._frontends.delete(frontend);
    this._gotfrontends.setSignalled(this._frontends.size !== 0);
  }

  setFrontendListenLinks(frontend, links, frontendids)
  {
    let obj = this._frontends.get(frontend);
    obj.links = links;
    obj.frontendids = frontendids;
    this._sendListenLinks();
  }

  sendRequests(frontend, requests)
  {
    this._sendRequests(requests);
  }
}

export default SocketHandler;
