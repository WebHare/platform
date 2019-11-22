/** @require: var JSONRPC = require('@mod-system/js/net/jsonrpc')
*/
const InternetRequester = require('./requester');
import * as whintegration from '@mod-system/js/wh/integration';
import * as dompack from 'dompack';

var rpcscriptid = Math.floor(Math.random()* 1000);

class JSONRPC extends InternetRequester
{
  /** @short RPC status codes (defined as getter-only properties as long as we don't have static const properties) */
  static get HTTP_ERROR()     { return -1; } // Error connecting to the RPC server
  static get JSON_ERROR()     { return -2; } // The returned value could not be decoded into a JSON object
  static get PROTOCOL_ERROR() { return -3; } // The return object did not contain an id, or the id did not match the request id
  static get RPC_ERROR()      { return -4; } // The RPC returned an error
  static get OFFLINE_ERROR()  { return -5; } // The application is not online (only returned if the onlineonly option was set)
  static get TIMEOUT_ERROR()  { return -6; } // The request could not be sent or was not answered before within the timeout set in the options
  static get SERVER_ERROR()   { return -7; } // The server encountered an internal error

  constructor(options)
  {
    super(options);
    if(!options)
      options={};

    this.lastid = 0;
    this.requestqueue = [];
    this.cachecounter = 0;
    this.activerequest = null;
    this.haveresponse = false;
    //timeout after which we trigger a 'wait' action, eg a spinner
    this.options.waittimeout = 'waittimeout' in options ? options.waittimeout : 500;
    this.options.appendfunctionname = 'appendfunctionname' in options ? options.appendfunctionname : false;
    this.waitcallback = null;
    this.waittimeoutid = null;
    this.waitingnow = false;

    this.on("requestend", this.onResponse.bind(this));
  }

  destroy()
  {
    super.destroy();
    this.requestqueue = [];
    this.activerequest = null;

    if (this.waittimeoutid)
    {
      clearTimeout(this.waittimeoutid);
      this.waittimeoutid = null;
    }
  }

  promiseRequest(method, params, options)
  {
    let deferred = dompack.createDeferred();
    let req = this.request(method, params, deferred.resolve, (errorcode, errormsg, rpcid) => { deferred.reject(new Error(errormsg)); }, options);
    deferred.promise.__jsonrpcinfo = { deferred, req };
    return deferred.promise;
  }
  async(method, ...params)
  {
    return this.promiseRequest(method, params);
  }

  _doAsyncAbort(promise, result, rejection)
  {
    if(!promise.__jsonrpcinfo)
      throw new Error("The promise is not an async JSONRPC request");
    if(!rejection)
      promise.__jsonrpcinfo.deferred.resolve(result);
    else
      promise.__jsonrpcinfo.deferred.reject(rejection);
    promise.__jsonrpcinfo.req.cancel();
  }

  rpcResolve(promise, result)
  {
    this._doAsyncAbort(promise, result);
  }
  rpcReject(promise, rejection)
  {
    this._doAsyncAbort(promise, null, rejection);
  }


/**
 * @short Queue an RPC request
 * @param method The RPC method to call
 * @param params Params for the RPC method
 * @param callback The callback which is called, with:
 *                 param status A JSONRPC. value
 *                 param result The result object as sent by the RPC, or an error message string sent by the RPC, or an error
 *                              message
 *                 param id The request id
 * @param options Options
 * @param options.url The URL to connect to
 * @param options.timeout Timeout in ms after which the request will fail (callback is called with ERROR_TIMEOUT error)
 * @param options.waittimeout Timeout in ms after which the request will set waiting status to TRUE (via the waitCallback)
 *                Set negative to not trigger waiting status.
 * @return The request id
 */
  request(method, params, onsuccess, onfailure, options)
  {
    if(!params || typeof params != "object" || params.length === undefined)
      throw "The parameters passed to request must be an Array";

    var id = ++this.lastid;

    var url;
    if(options && options.url)
      url = options.url + (options.appendfunctionname ? (options.url.match(/\/$/) ? '' : '/') + method : '');
    else if(this.options.url)
      url = this.options.url + (this.options.appendfunctionname ? (this.options.url.match(/\/$/) ? '' : '/') + method : '');
    else
      url = location.href; //we do not support appendfunctionname for self-posts

    var timeout = Math.max((options && typeof options.timeout == "number") ? options.timeout : 0, 0);
    var waittimeout = (options && typeof options.waittimeout == "number") ? options.waittimeout : this.options.waittimeout;
    var synchronous = options && options.synchronous || false;
    var errortrace = options && options.errortrace || null;

    if (this.options.log)
      console.log("JSONRPC request", method, params, options, 'timeout:', timeout, 'waitTimeout:', waittimeout);

    var request = new Request(this, id, method, params, url, timeout, waittimeout, onsuccess, onfailure, synchronous, errortrace);
    if (this.options.log || !whintegration.config || !whintegration.config.islive)
      request.stack = new Error().stack;

    this.requestqueue.push(request);
    if (this.options.log)
      console.log("JSONRPC request is on queue");
    this.processNextRequest();
    return request;
  }

  handleError(onfailure, errorcode, errormsg, rpcid)
  {
    if(onfailure)
      setTimeout( () => onfailure(errorcode, errormsg, rpcid), 0);

    setTimeout( () => this.emit([ "error", { target: this, errorcode: errorcode, errormessage: errormsg, rpcid: rpcid } ]), 0);
  }

  //is a json request pending?
  isRequestPending()
  {
    return this.activerequest !== null || this.requestqueue.length;
  }

  //ADDME is it possible for the 'next' response to already be .delay/setTimeout() scheduled, racing against our cancel ?
  __cancelRequest(id)
  {
    if(typeof id != 'number')
      return;

    if (this.activerequest == id)
    {
      this.stopCurrentRequest();
      this.activerequest = null;

      var request = this.requestqueue.shift();
      if (request.timeout && typeof request.timeout != "boolean")
        clearTimeout(request.timeout);

      this.processNextRequest();
    }
    else
    {
      for (var i = 0; i < this.requestqueue.length; ++i)
        if (this.requestqueue[i].id == id)
        {
          this.requestqueue.splice(i, 1);
          break;
        }
    }
  }

  processNextRequest()
  {
    if (this.activerequest)
    {
      if(this.options.log)
        console.log("JSONRPC request #" + this.activerequest + " pending, not scheduling a new one yet");
      this.handleWaitTimeouts();
      return;
    }

    var request = null;
    while (!request)
    {
      request = this.requestqueue[0];
      if (!request)
      {
        if(this.options.log)
          console.log("JSONRPC request - processNextRequest, queue is empty");
        return;
      }
      if (request.timeout && typeof request.timeout == "boolean")
      {
        this.requestqueue = this.requestqueue.filter(el => el != request);
        request = this.requestqueue[0];
      }
    }

    this.activerequest = request.id;

    if (request.timeout)
      request.timeout = setTimeout( () => this.onTimeout(request), request.timeout);

    if(this.options.log)
      console.log("JSONRPC request #" + request.id + " offering for XMLHTTP");
    this.startXMLHTTPRequest(
          "post",
          request.url,
          JSON.stringify(request.request),
          { headers: { "Content-Type": "application/json; charset=utf-8" }
          , synchronous: request.synchronous
          });
    this.handleWaitTimeouts();
  }

  onResponse(event)
  {
    this.activerequest = null;

    var request = this.requestqueue[0];
    if (!request)
      return;

    this.requestqueue = this.requestqueue.slice(1);

    if (request.timeout)
    {
      if (typeof request.timeout == "boolean")
      {
        this.processNextRequest();
        return;
      }
      clearTimeout(request.timeout);
    }

    var status = -1;
    var result = null;

    if (!event.success)
    {
      status = JSONRPC.HTTP_ERROR;
      result = "HTTP Error: " + event.message;

      if (event.internalerror)
      {
        let json = null;
        try
        {
          json = event.responsejson;
          var trace;
          if(json && json.error && json.error.data)
          {
            trace = json.error.data.trace || json.error.data.errors || json.error.data.list || [];

            console.group();
            var line = "RPC #" + rpcscriptid +":"+ request.id  + " failed: " + json.error.message;
            console.warn(line);
            if (request.errortrace)
              request.errortrace.push(line);
            trace.forEach(rec =>
            {
              if (rec.filename || rec.line)
              {
                var line = rec.filename + '#' + rec.line + '#' + rec.col + (rec.func ? ' (' + rec.func + ')' : '');
                console.warn(line);
                if (request.errortrace)
                  request.errortrace.push(line);
              }
            });
            console.groupEnd();
          }
          status = JSONRPC.SERVER_ERROR;
          result = json.error && `${json.error.message} from ${request.url}` || "Unknown error";
        }
        catch (e)
        {
        }
      }
    }
    else
    {
      let json = event.responsejson;

      if (!json)
      {
        status = JSONRPC.JSON_ERROR;
        result = "Invalid JSON response";
      }
      else if (json.id === null || json.id != request.id)
      {
        status = JSONRPC.PROTOCOL_ERROR;
        result = "Protocol error: invalid id";
      }
      else if (json.error !== null)
      {
        status = JSONRPC.RPC_ERROR;
        result = json.error;
        if(this.options.log)
          console.log('RPC error:', result.message ? result.message : '*no message*');
      }
      else if ("result" in json)
      {
        status = 0;
        result = json.result;
      }
      else
      {
        status = JSONRPC.PROTOCOL_ERROR;
        result = "Could not interpret response";
      }
    }

    this.processNextRequest();

    if (this.options.log)
    {
      console.log("JSONRPC request", request.request.method, 'status:', status, 'time:', (new Date).getTime()- request.scheduled, 'ms, result:');
      console.log(result);
    }

    /*
    console.log({ serverdate: this.__date_server
                , clientdate: this.__date_client
                , diff: this.__date_diff
                });
    */
    setTimeout( () => request.__completedCall(status, result, event),0 );
  }

  onTimeout(request)
  {
    request.timeout = true;
    if (this.activerequest == request.id)
    {
      this.activerequest = null;
      this.stopCurrentRequest();
      this.processNextRequest();
    }
    this.handleError(request.onfailure, JSONRPC.TIMEOUT_ERROR, "Timeout while waiting for response", request.id);
  }

  onWaitTimeout()
  {
    this.waittimeoutid = null;
    this.handleWaitTimeouts();
  }

  handleWaitTimeouts()
  {
    if (this.waittimeoutid)
    {
      clearTimeout(this.waittimeoutid);
      this.waittimeoutid = null;
    }

    if (!this.waitCallback)
      return;

    var waiting = false;
    var nextTimeout = -1;

    var now = (new Date).getTime();
    for (var i = 0; i < this.requestqueue.length; ++i)
    {
      var req = this.requestqueue[i];
      if (req.waitTimeout >= 0)
      {
        var waitLength = now - req.scheduled;

        if (waitLength >= req.waitTimeout)
          waiting = true;
        else
        {
          var toGo = req.waitTimeout - waitLength;
          if (nextTimeout < 0 || nextTimeout > toGo)
            nextTimeout = toGo;
        }
      }
    }

    if (this.waitingNow != waiting)
    {
      this.waitingNow = waiting;
      setTimeout( () => this.waitCallback(waiting), 0);
    }

    if (nextTimeout >= 0)
      this.waittimeoutid = setTimeout( () => this.onWaitTimeout(), nextTimeout);
  }

  getEstimatedServerTime()
  {
    return new Date().getTime() + this.__date_diff;
  }

  /** @short estimate the server's datetime based on the known descrepancy between the date of an reponse from the server and the time on the client
  */
  getEstimatedServerDate()
  {
    return new Date(this.getEstimatedServerTime());
  }
}

class Request //extends PreloadableAsset
{
  constructor(parent, id, method, params, url, timeout, waittimeout, onsuccess, onfailure, synchronous, errortrace)
  {
//    super();

    this.cancelled = false;
    this.stack = null;

    if (parent.options.log)
      console.log('req',this);
    this.parent=parent;
    this.id = id;
    this.request = { id: id
                   , method: method
                   , params: params || []
                   };
    this.url = url;
    this.onsuccess = onsuccess;
    this.onfailure = onfailure;
    this.timeout = timeout;
    this.scheduled = new Date-0;
    this.waittimeout = waittimeout;
    this.synchronous = synchronous;
    this.errortrace = errortrace;

    //this.startPreload();
  }
  onStartPreload()
  {

  }
  cancel()
  {
    //we need to prevent a race when our parent invokes cancel(), but we actually had our __completedCall already queued up. if we still fire onsuccess/onfailure, our parent might think we completed the _next_ request our parent submitted
    this.cancelled=true;
    this.parent.__cancelRequest(this.id);
  }

  __completedCall(status,result,event)
  {
    if(event.isaborted)
      this.cancelled=true;

    if(status == 0)
    {
      if(this.onsuccess && !this.cancelled)
        this.onsuccess(result);
      //this.donePreload(true);
    }
    else
    {
      if(!this.cancelled)
      {
        if(this.stack)
        {
          console.log("Stack at calling point:");
          console.log(this.stack);
        }
        this.parent.handleError(this.onfailure, status, result, this.id);
      }
      //this.donePreload(false);
    }
  }
}

module.exports=JSONRPC;
