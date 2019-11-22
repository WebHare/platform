
import FIFO from "@mod-system/js/internal/util/fifo.es";
import WaitableTimer from "@mod-system/js/internal/util/waitabletimer.es";
import FrontendLinkBase from "./frontendlinkbase.es";

let pinginterval = 6; // Send a ping every 6 seconds
let pongtimeout = 5; // Expect an pong response max 5 seconds after the ping. Must be less than pinginterval
let maxmissedpongs = 3; // After 3 missed pongs, assume the remote tab is gone

let portcounter = 0;

let debuglog = false;

/// This class defines a frontend link in the shared worker. It communicates via the sharedworker port to the frontend tab.
class SharedWorkerFrontendLink extends FrontendLinkBase
{
  constructor(sockethandler, port)
  {
    super();

    /// Id for debugging purposes
    this._id = ++portcounter;
    /// Associated socket handler
    this._sockethandler = sockethandler;
    /// Message port
    this._port = port;
    /// Fifo
    this._porteventfifo = new FIFO;
    /// Pong timeout
    this._pongtimeout = new WaitableTimer;
    /// Whether already registered
    this._registered = false;
    /// Name the pongtimeout, for debugging purposes
    this._pongtimeout.name = "frontendlink-pong";

    /// Push all messages from the port into the fifo
    port.addEventListener("message", e => this._porteventfifo.push(e));

    this._run();

    // Start the port after all is set up
    port.start();
  }

  /** Event loop for this message port
  */
  async _run()
  {
    // Send a ping every 6 seconds.
    //let pingintervalcb = setInterval(function() { this._sendPing() }.bind(this), pinginterval * 1000);
    let pingintervalcb = setInterval(() => this._sendPing(), pinginterval * 1000);
    let missingpongs = 0;

    this._sendPing();

    while (this._port)
    {
      var promises = [ this._porteventfifo.waitSignalled(), this._pongtimeout.waitSignalled() ];
      let waitres = await Promise.race(promises);
      if (waitres === this._pongtimeout)
      {
        this._pongtimeout.reset();
        if (debuglog)
          console.log("Port " + this._id + " got pong timeout, now at", missingpongs + 1);
        if (++missingpongs >= maxmissedpongs)
        {
          // Too much missed pongs
          this._close("Missed too many pong replies");
        }
      }
      else
      {
        let e = this._porteventfifo.shift();
        if (debuglog)
          console.log("Port " + this._id + " got an incoming message", e.data);
        switch (e.data.type)
        {
        case "pong":
          {
            missingpongs = 0;
          } break;
        case "tollium-ws-openconnection":
          {
            if (!this._registered)
            {
              this._registered = true;
              this._sockethandler.registerFrontendLink(this);
            }
          } break;
        case "tollium-ws-setlistenlinks":
          {
            this._sockethandler.setFrontendListenLinks(this, e.data.links, e.data.frontendids);
          } break;
        case "tollium-ws-sendrequests":
          {
            this._sockethandler.sendRequests(this, e.data.requests);
          } break;
        case "close":
          {
            this._close("Closed by remote side");
          } break;
        }
      }
    }

    clearTimeout(pingintervalcb);
  }

  _sendPing()
  {
    if (debuglog)
      console.log("Port " + this._id + " sending a ping to the other side");
    this._port.postMessage({ type: "ping" });
    this._pongtimeout.reset(pongtimeout * 1000);
  }

  _close(msg)
  {
    if (this._registered)
      this._sockethandler.unregisterFrontendLink(this);

    // Send a message to the other side, just to be sure
    if (debuglog)
      console.log("Port " + this._id + " closing");
    this._port.postMessage({ type: "close", message: msg });
    this._port.close();
    this._port = null;
  }


  /** Set the current status of the server link
      @param newstatus New status ("offline", "online")
  */
  handleStatusUpdate(newstatus)
  {
    if (debuglog)
      console.log("Port " + this._id + " sending a status update to the other side: " + newstatus);
    this._port.postMessage({ type: newstatus });
  }

  /** Handles an incoming message
  */
  handleMessage(message)
  {
    if (debuglog)
      console.log("Port " + this._id + " sending a message to the other side", message);
    this._port.postMessage({ type: "message", data: message });
  }
}

module.exports = SharedWorkerFrontendLink;
