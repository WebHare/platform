import $todd from "@mod-tollium/web/ui/js/support";

/** Implements the todd end of a reliable communication link
*/
export default class LinkEndpoint
{ // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(options)
  {
  // Current sequence nr for messages
    this.msgcounter = 0;

    // List of meessages (unacked & unsent)
    this.queuedmessages = [];

    // Don't transmit immediately
    this.stoptransmit = false;

    // Seqnr of last message sent over the wire
    this.lastsentseqnr = 0;

    // Seqnr of last (correctly) received message
    this.lastreceivedseqnr = 0;

    // Linked TransportManager
    this.transmgr = null;

    // Transport (used by TransportManager)
    this.transport = null;

    // Set to true when a new message was seen since the last constructed wire message
    this.seennewmessage = false;

    // Current online status
    this.online = false;

    // options
    this.options =
        { linkid:  ''
        , commhost: ''
        , frontendid: ''
        , ...options
        };

    //console.log('** new endpoint', this.options.linkid, this.options.frontendid, this.options.commhost);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  /* Processes incoming wire message
     @return Whether all messages were sent
  */
  processWireMessage(wiremsg)
  {
    //console.log('** wire msg', wiremsg);

    if (wiremsg.status == "gone")
    {
//      console.log('** link closed - unregistering');
      if (this.onclosed && this.transmgr)
        this.onclosed();
      this.unregister();
      return true;
    }

    // Remove ack'ed messages
    let i = 0;
    for (; i < this.queuedmessages.length; ++i)
      if (this.queuedmessages[i].seqnr > wiremsg.ack)
        break;

    // Dispatch all messages we haven't received yet
    this.queuedmessages.splice(0, i);

    for (i = 0; i < wiremsg.messages.length; ++i)
    {
      //console.log('dispatch message', this.options.linkid, wiremsg.messages[i].seqnr, this.lastreceivedseqnr + 1);
      if (wiremsg.messages[i].seqnr == this.lastreceivedseqnr + 1)
      {
        // Mark as received first, processing the message can throw...
        ++this.lastreceivedseqnr;
        this.seennewmessage = true;

        //console.log('onmessage');
        this.onmessage(wiremsg.messages[i].data);

      }
    }

    return this.queuedmessages.length == 0;
  }

  constructWireMessage(sendall)
  {
    var startmsgpos = 0;
    if (!sendall)
      for (; startmsgpos < this.queuedmessages.length; ++startmsgpos)
        if (this.queuedmessages[startmsgpos].seqnr > this.lastsentseqnr)
          break;

    this.lastsentseqnr = this.msgcounter;
    var wiremsg =
        { linkid: this.options.linkid
        , messages: this.queuedmessages.slice(startmsgpos)
        , ack: this.lastreceivedseqnr
        , frontendid: this.options.frontendid
        , needack: this.queuedmessages.length != 0
        };

    this.seennewmessage = false;
    return wiremsg;
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Register this endpoint with a communicationManager
  register(transmgr)
  {
    this.transmgr = transmgr;
    this.transmgr.register(this);
    // Automatically signalled
  }

  /// Unregister the endpoint
  unregister()
  {
    if (this.transmgr)
      this.transmgr.unregister(this);
    this.transmgr = null;
    this.queuedmessages=[];
  }

  /// Queue a new message. Returns the message nr (which is monotonically increasing in time)
  queueMessage(message)
  {
    $todd.DebugTypedLog("rpc", '** QUEUE MESSAGE',message);
    this.queuedmessages.push({ seqnr: ++this.msgcounter, data: message });

    if (!this.stoptransmit && this.transport)
      this.transport.setSignalled(this);

    return this.msgcounter;
  }

  /** Indicate that messages have been received through another channel. Pass the seqnr of the last message.
      Use this when initial messages are transferred by service call before setting up the comm channel.
  */
  registerManuallyReceivedMessage(seqnr)
  {
    //console.log('registerManuallyReceivedMessage', seqnr);
    this.lastreceivedseqnr = seqnr;
  }
}
