import * as $todd from "@mod-tollium/web/ui/js/support";
import type TransportManager from "./transportmanager";
import type TransportBase from "./transportbase";

interface LinkEndpointOptions {
  linkid: string;
  commhost: string;
  frontendid: string;
}

export interface BaseWireMessage {
  linkid: string;
  messages: Array<{
    seqnr: number;
    data: unknown;
  }>;
  ack: number;

}

export interface LinkWireMessage extends BaseWireMessage {
  frontendid: string;
  needack: boolean;
  status?: "gone";
}

/** Implements the todd end of a reliable communication link
*/
export class LinkEndpoint {
  // Current sequence nr for messages
  msgcounter = 0;

  // List of meessages (unacked & unsent)
  queuedmessages = new Array<{
    seqnr: number;
    data: unknown;
  }>;

  // Don't transmit immediately
  stoptransmit = false;

  // Seqnr of last message sent over the wire
  lastsentseqnr = 0;

  // Seqnr of last (correctly) received message
  lastreceivedseqnr = 0;

  // Linked TransportManager
  transmgr: TransportManager | null = null;

  // Transport (used by TransportManager)
  transport: TransportBase | null = null;

  // Set to true when a new message was seen since the last constructed wire message
  seennewmessage = false;

  // Current online status
  online = false;

  onmessage: ((msg: unknown) => void) | null = null;
  onclosed: (() => void) | null = null;

  options: LinkEndpointOptions;


  //
  // Constructor
  //
  constructor(options?: Partial<LinkEndpointOptions>) {
    // options
    this.options = {
      linkid: '',
      commhost: '',
      frontendid: '',
      ...options
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
  processWireMessage(wiremsg: LinkWireMessage) {
    //console.log('** wire msg', wiremsg);

    if (wiremsg.status === "gone") {
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
    this.queuedmessages.splice(0, i);

    // Dispatch all messages we haven't received yet
    for (i = 0; i < wiremsg.messages.length; ++i) {
      //console.log('dispatch message', this.options.linkid, wiremsg.messages[i].seqnr, this.lastreceivedseqnr + 1);
      if (wiremsg.messages[i].seqnr === this.lastreceivedseqnr + 1) {
        // Mark as received first, processing the message can throw...
        ++this.lastreceivedseqnr;
        this.seennewmessage = true;

        //console.log('onmessage');
        if (!this.onmessage)
          throw new Error("No onmessage handler set");
        this.onmessage(wiremsg.messages[i].data);
      }
    }

    return this.queuedmessages.length === 0;
  }

  constructWireMessage(sendall: boolean): LinkWireMessage {
    let startmsgpos = 0;
    if (!sendall)
      for (; startmsgpos < this.queuedmessages.length; ++startmsgpos)
        if (this.queuedmessages[startmsgpos].seqnr > this.lastsentseqnr)
          break;

    const sendmessages = this.queuedmessages.slice(startmsgpos);
    if (sendmessages.length)
      this.lastsentseqnr = sendmessages.at(-1)!.seqnr;

    const wiremsg =
    {
      linkid: this.options.linkid,
      messages: sendmessages,
      ack: this.lastreceivedseqnr,
      frontendid: this.options.frontendid,
      needack: this.queuedmessages.length !== 0
    };

    this.seennewmessage = false;
    return wiremsg;
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Register this endpoint with a communicationManager
  register(transmgr: TransportManager) {
    this.transmgr = transmgr;
    this.transmgr.register(this);
    // Automatically signalled
  }

  /// Unregister the endpoint
  unregister() {
    if (this.transmgr)
      this.transmgr.unregister(this);
    this.transmgr = null;
    this.queuedmessages = [];
  }

  /// allocate a message number (which is monotonically increasing in time)
  allocMessageNr() {
    return ++this.msgcounter;
  }

  /// Queue a new message with the earlier seqnr
  queueMessageWithSeqnr(seqnr: number, message: unknown) {
    $todd.DebugTypedLog("rpc", '** QUEUE MESSAGE', message);
    this.queuedmessages.push({ seqnr, data: message });

    if (!this.stoptransmit && this.transport)
      this.transport.setSignalled(this);
  }

  /** Indicate that messages have been received through another channel. Pass the seqnr of the last message.
      Use this when initial messages are transferred by service call before setting up the comm channel.
  */
  registerManuallyReceivedMessage(seqnr: number) {
    //console.log('registerManuallyReceivedMessage', seqnr);
    this.lastreceivedseqnr = seqnr;
  }

  close() {
    if (this.onclosed && this.transmgr)
      this.onclosed();
    this.unregister();
  }
}

export default LinkEndpoint;
