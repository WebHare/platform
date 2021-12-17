import * as dompack from 'dompack';
const EventEmitter = require('events');

class InternetRequester extends EventEmitter
{
  constructor(options)
  {
    super();
    if(!options)
      options={};
                   //Host url of event server
    this.options = { url: options.url || ''
                   , log: Boolean(options.log || dompack.debugflags.rpc)
                   , withcredentials: 'withCredentials' in options && options.withcredentials
                   };

    // XMLHttpRequest
    this.conn = null;

    // used for estimating the server date
    this.__date_server = null;
    this.__date_client = null;
    this.__date_diff = null;
  }

  destroy()
  {
    this.stopCurrentRequest();
    this.conn = null;
  }

  stopCurrentRequest()
  {
    if(this.conn)
    {
      this.conn.onreadystatechange = null;
      this.conn.onloadend = null;

      this.conn.abort();
    }
    if (this.jsoncheckinterval)
    {
      clearTimeout(this.jsoncheckinterval);
      this.jsoncheckinterval = null;
    }
  }

  ensureConnection()
  {
    if (!this.conn)
      this.conn = new XMLHttpRequest();
  }

  startXMLHTTPRequest(method, url, body, options)
  {
    this.ensureConnection();

    var async = !options || !options.synchronous;

    // Because aborting the connection may result in a readystatechange event (yes, we're looking at you, Titanium's
    // TiNetworkHTTPClient...), we have to reset the have_response flag _after_ aborting the connection, so the response for
    // the previous request isn't used for the new request

    this.laststateevent = null; //make sure we don't accidentally cancel the previous request
    this.conn.abort();
    this.have_response = false;

    this.conn.open(method.toUpperCase(), url, async);
    if(options && options.headers)
      Object.keys(options.headers).forEach(key => { this.conn.setRequestHeader(key,options.headers[key]); });

    if(this.options.withcredentials)
      this.conn.withCredentials = true;

    this.conn.onreadystatechange = this.onStateChange.bind(this);
    // Required for Firefox 12 (+firebug?), without it statechange to 4 doesn't seem to be fired sometimes
    this.conn.onloadend = this.onStateChange.bind(this);
    this.conn.onabort = this.onAbort.bind(this);

    this.emit("requeststart", { target: this });
    this.conn.send(body);

    if (!async)
      this.onStateChange();
  }

  onAbort(event)
  {
    if(this.laststateevent)
      this.laststateevent.isaborted = true;
  }

  onStateChange (event)
  {
    if (this.conn.readyState != 4 || this.have_response)
      return;

    this.have_response = true;

    var datestr = this.conn.getResponseHeader("date");
    if (datestr != "")
    {
      var parseddate = Date.parse(datestr);
      this.__date_server = parseddate;
      this.__date_client = new Date();
      this.__date_diff = this.__date_server - this.__date_client;
    }

    var evt = { target: this
              , success: this.conn.status == 200
              , internalerror: this.conn.status == 500
              , message: this.conn.status

              , responsetext: this.conn.responseText
              , responsejson: null
              };

    //FIXME only decode JSON data if the mimetype specified it was JSON, and then log any errors
    try
    {
      evt.responsejson = JSON.parse(evt.responsetext);
    }
    catch(e)
    {
    }

    this.laststateevent = evt;
    this.emit("requestend", evt);
  }
}

module.exports = InternetRequester;
