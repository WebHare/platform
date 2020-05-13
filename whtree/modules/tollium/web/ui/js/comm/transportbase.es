const utilerror = require('@mod-system/js/wh/errorreporting');

export default class TransportBase
{ constructor(options)
  {
    this.serializer = null;

    /// List of endpoints
    this.endpoints = [];

    this.options =
        { commurl:          ''
        , onrequestneeded:  null
        , onresponse:       null
        , ononline:         null
        , onoffline:        null
        , ...options
        };

    this.serializer = Promise.resolve();
  }

  destroy()
  {
  }

  setSignalled(endpoint)
  {
  }

  addEndPoint(endpoint)
  {
    endpoint.transport = this;
    this.endpoints.push(endpoint);
  }

  removeEndPoint(endpoint)
  {
    endpoint.transport = null;
    this.endpoints = this.endpoints.filter(e => e != endpoint);
    return this.endpoints.length != 0;
  }

  /// Called within onunload handler - to push out stuff as quick as possible
  runUnloadHandler()
  {
  }

  processGotMessageMessage(msg)
  {
    // Finally process the message _finally to absorb crashes.
    this.serializer = this.serializer.finally(this.processWireMessage.bind(this, msg)).catch(utilerror.reportException);
  }

  processWireMessage(msg)
  {
    for (var j = 0; j < this.endpoints.length; ++j)
      if (this.endpoints[j].options.linkid == msg.linkid)
      {
        var endpoint = this.endpoints[j];

        // FIXME trycatch!
        endpoint.processWireMessage(msg);

        if (endpoint.seennewmessage && this.endpoints.includes(endpoint))
          this.gotNewMessage(endpoint);
      }
  }

  // Called when a new message has arrived at an endpoint
  gotNewMessage(endpoint)
  {
  }

  signalOnline()
  {
    if(this.online)
      return;

    this.online=true;
    if (this.options.ononline)
      this.options.ononline();
  }

  signalOffline()
  {
    if(!this.online)
      return;

    this.online=false;
    if (this.options.onoffline)
      this.options.onoffline();
  }
}
