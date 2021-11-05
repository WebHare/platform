"use strict";

const Events = require("events");
const stacktrace_parser = require("stacktrace-parser");
const tools = require('@mod-system/js/internal/tools.js');

class IPCLink extends Events.EventEmitter
{
  constructor(webharebridge, linkid)
  {
    super();
    this._bridge = webharebridge;
    this._id = linkid;
    this._closed = false;
  }

  send(message, replyto)
  {
    return this._bridge._sendMessage({ type: "message", id: this._id, message: message, replyto: replyto || 0 });
  }

  doRequest(message)
  {
    return this._bridge._doRequest({ type: "message", id: this._id, message: message, replyto: 0 });
  }

  sendException(e, replyto)
  {
    this.send(
        { __exception:
              { type:  "exception"
              , what:  e.message
              , trace: this._bridge.getStructuredTrace(e)
              }
        , replyto: replyto || 0
        });
  }

  close()
  {
    this._bridge._closeLink(this._id);
  }
}

class IPCListenerPort extends Events.EventEmitter
{
  constructor(webharebridge, portid)
  {
    super();
    this._bridge = webharebridge;
    this._id = portid;
    this._closed = false;
  }

  close()
  {
    this._bridge._closePort(this._id);
  }
}

class WebHareServiceWrapper
{
  constructor(port, response)
  {
    this._port = port;
    this._promiselist = [];
    this._port.on("message", (message, msgid) => this.__onPortMessage(message,msgid));

    let self=this;
    response.methods.forEach(method =>
    {
      this[method.name] = function(...args) { return self.__remotingFunc(method, args); };
    });
  }

  __remotingFunc(method, args)
  {
    return this._port.doRequest({call: method.name, args: args }).then(response =>
    {
      if(response.result)
        return response.result;

      if(response.__promiseseq)
      {
        var defer = tools.createDeferred();
        var idx = this._promiselist.findIndex(el => el.id == response.__promiseseq);
        if(idx < 0)
        {
          this._promiselist.push ( { id: response.__promiseseq, defer: defer});
        }
        else
        {
          var message = this._promiselist[idx].response;
          defer[message.type](message.value);
          this._promiselist.splice(idx,1);
        }
        return defer.promise;
      }

      console.error("Unexpected response (returned an empty record?)",response);
      throw new Error("Unexpected response (returned an empty record?)");
    });

/*    RECORD outmsg := [ call := tocall, args := args ];
    IF(__logdebug_services)
      LogDebug("services.whlib", "sendmessage req", outmsg);
    RECORD res := this->__link->SendMessage(outmsg);
*/
  }

  __onPortMessage(message, msgid)
  {
    if(message.__promiseseq)
    {
      var idx = this._promiselist.findIndex(el => el.id == message.__promiseseq);
      if(idx < 0)
      {
        this._promiselist.push ( { id: message.__promiseseq, response: message });
        return;
      }
      var promise = this._promiselist[idx];
      this._promiselist.splice(idx,1);
      promise.defer[message.type](message.value);
    }
  }
}

let bridgeid = 0;

class WebHareBridge extends Events.EventEmitter
{
  constructor(options)
  {
    let WebSocket = require("ws");
    super();

    let loopbackport;
    if(options && options.loopbackport)
      loopbackport = options.loopbackport;
    else
    {
      loopbackport =  parseInt(process.env.WEBHARE_LOOPBACKPORT,10);
      if(!loopbackport)
        throw new Error("Loopback port unavailable. Env WEBHARE_LOOPBACKPORT should be set");
    }

    this._bridgeid = ++bridgeid;
    this.debug = false;
    this.gotfirstmessage = false;
    this.sentmessages = [];
    this.pendingrequests = [];
    this.ports = [];
    this.links = [];
    this.eventcallbacks = [];
    this.nextid = 0;
    this.nextmsgid = 0;
    this.socket = new WebSocket("ws://127.0.0.1:" + loopbackport + "/bridge.whsock"); //FIXME should have gotten loopback addres elsehwere
    this.socket.on("message", this._onMessage.bind(this));
    this.socket.on("error", this._onError.bind(this));
    this.socket.on("close", this._onClose.bind(this));
    //this.socket.on("open", this.onOpen.bind(this));
    this.onlinepromise = new Promise( (resolve,reject) => { this.onconnect = resolve; this.onconnectfail = reject; });
  }

  connect(options)
  {
    if(options && 'debug' in options)
      this.debug = options.debug;
    return this.onlinepromise;
  }

  _addCallbackBeforeResolve(callback, resolve, reject)
  {
    if (!callback)
      return resolve;

    return data =>
    {
      try
      {
        callback(data);
        resolve(data);
      }
      catch (e)
      {
        reject(e);
      }
    };
  }

  _onMessage(data, flags)
  {
    data = JSON.parse(data);
    if(!this.gotfirstmessage)
    {
      this.gotfirstmessage=true;
      this._onVersionInfo(data);
      return;
    }
    if(this.debug)
      console.log("webhare-bridge " + this._bridgeid + ": received message:", data, flags);

    switch (data.type)
    {
      case "response-ok":
      {
        let req = this.sentmessages.find(item => item.msgid == data.msgid);
        if (req)
        {
          this.sentmessages.splice(this.sentmessages.indexOf(req), 1);
          req.resolve(data.value);
        }
        return;
      }
      case "response-exception":
      case "response-error":
      {
        let req = this.sentmessages.find(item => item.msgid == data.msgid);
        if (req)
          req.reject(data.what);
        return;
      }

      case "port-accepted":
      {
        let portrec = this.ports.find(item => item.msgid == data.msgid);
        if (!portrec)
        {
          console.error("webhare-bridge", this._bridgeid, ": received accept for nonexisting port #" + data.id);
          return;
        }

        if(this.debug)
          console.log("webhare-bridge", this._bridgeid, ": accepted connection on port #" + data.id  + " new link #" + data.link);

        let newlink = new IPCLink(this, data.link);
        this.links.push({ id: data.link, link: newlink });
        if (!portrec.port._closed)
          portrec.port.emit("accept", newlink);
        else
          newlink.close();
        return;
      }

      case "link-message":
      {
        if(data.replyto) //it's a response
        {
          let responseidx = this.pendingrequests.findIndex(el => el.msgid == data.replyto);
          if(responseidx < 0)
          {
            console.error("webhare-bridge", this._bridgeid, ": received reply to unknown request #" + data.replyto);
            console.log(data.message);
            return;
          }

          let req = this.pendingrequests[responseidx];
          this.pendingrequests.splice(responseidx,1);

          //FIXME when to reject
          req.resolve(data.message);
          return;
        }

        let linkrec = this.links.find(el => el.id == data.id);
        if (!linkrec)
        {
          console.error("webhare-bridge", this._bridgeid, ": received message " + data.message + " for nonexisting port #" + data.id);
          return;
        }
        if (!linkrec.link._closed)
        {
          linkrec.link.emit("message", data.message, data.msgid);
        }
        return;
      }

      case "link-gone":
      {
        // Link establishment runs in a promise resolve handler, so removal must do so too to fix ordering issues
        Promise.resolve(true).then(() =>
        {
          this.pendingrequests.filter(el => el.linkid == data.id).forEach(el => el.reject(new Error("link disconnected")));
          this.pendingrequests = this.pendingrequests.filter(el => el.linkid != data.id);

          var linkidx = this.links.findIndex(el => el.id == data.id);
          if (linkidx == -1)
          {
            console.error("webhare-bridge", this._bridgeid, ": received disconnected for nonexisting link #" + data.id);
            return;
          }
          this.links.splice(linkidx, 1);
        });
        return;
      }

      case "eventcallback":
      {
        var eventcallback = this.eventcallbacks.find(el => el.id == data.id);
        if (eventcallback)
          eventcallback.callback(data.event, data.data);
        return;
      }
    }
    console.error("webhare-bridge", this._bridgeid, ": unexpected command " + data.cmd);
    console.log(data);
  }

  _closePort(id)
  {
    let port = this.ports.find(el => el.id == id);
    if (!port || port._closed)
    {
      console.error("webhare-bridge", this._bridgeid, ": closing port #" + id + " that was already closed");
      return;
    }
    port._closed = true;
    this._sendMessage({ type: "closeport", id: id }, () =>
    {
      let idx = this.ports.findIndex(el => el.id == id);
      this.ports.splice(idx, 1);
    });
  }

  _closeLink(id)
  {
    let link = this.links.find(el => el.id == id);
    if (!link || link._closed)
    {
      console.error("webhare-bridge", this._bridgeid, ": closing link #" + id + " that was already closed");
      return;
    }
    link._closed = true;
    this._sendMessage({ type: "closelink", id: id }, () =>
    {
      let idx = this.links.findIndex(el => el.id == id);
      this.links.splice(idx, 1);
    });
}

  /** Callback is called synchronously at message processing time
  */
  _sendMessage(data, callback)
  {
    if(!this.gotfirstmessage)
    {
      if(this.debug)
        console.error("Attempting to communicate over the bridge without waiting for the connection to establish");
      throw new Error("Attempting to communicate over the bridge without waiting for the connection to establish");
    }
    if (this._closed)
    {
      if(this.debug)
        console.error("webhare-bridge", this._bridgeid, ": sending message over a closed bridge: ", data);
      throw new Error(`Sending a message over a closed bridge`);
    }

    data.msgid = ++this.nextmsgid;
    var rec;
    var promise = new Promise((resolve, reject) =>
    {
      rec = { msgid: data.msgid, resolve: this._addCallbackBeforeResolve(callback, resolve, reject), reject: reject };
    });
    this.sentmessages.push(rec); //FIXME never cleaned

    if(this.debug)
      console.log("webhare-bridge", this._bridgeid, ": sending message: ", data);
    this.socket.send(JSON.stringify(data));

    return promise;
  }

  _doRequest(data)
  {
    return new Promise((resolve, reject) =>
    {
      this._sendMessage(data, responseinfo =>
      {
        if(responseinfo.status != "ok")
          throw new Error("Unexpected responseinfo '" + responseinfo.status + "'");

        this.pendingrequests.push( { linkid: data.id, msgid: responseinfo.msgid, resolve: resolve, reject: reject});
      }).catch(reject);
    });
  }

  _onError(error)
  {
    console.error("webhare-bridge", this._bridgeid, ": websocket reported error: " + error);
    this.onconnectfail(error);
  }

  _onClose()
  {
    this._closed = true;
    if(this.debug)
      console.log("webhare-bridge", this._bridgeid, ": the server has closed the connection");
    this.emit("close");
  }

  _send(data)
  {
    if (this._closed)
    {
      if(this.debug)
        console.error("webhare-bridge", this._bridgeid, ": sending message over a closed bridge: ", data);
      throw new Error(`Sending a message over a closed bridge`);
    }
    if(this.debug)
      console.log("webhare-bridge", this._bridgeid, ": sending message: ", data);
    this.socket.send(JSON.stringify(data));
  }

  _onVersionInfo(versiondata)
  {
    if(!versiondata.version)
      throw new Error("Retrieving version data failed, are we sure this is a WebHare port?");

    if(this.debug)
      console.log("webhare-bridge", this._bridgeid, ": connected. remote version = " + versiondata.version);
    this.versiondata=versiondata;
    this.onconnect( { version: versiondata.version });
  }

  getInstallationRoot()
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return this.versiondata.installationroot;
  }
  getModuleInstallationRoot(module)
  {
    return this.versiondata.moduleroots[module] || null;
  }
  getBaseDataRoot()
  {
    if(!this.versiondata)
      throw new Error("Requesting WebHare configuration data before the link was established");
    return this.versiondata.varroot;
  }
  getNodeModulePaths()
  {
    return [ this.getBaseDataRoot() + "nodejs/node_modules"
           , this.getInstallationRoot() + "node_modules"
           ];
  }

  close()
  {
    if(this.debug)
      console.log("webhare-bridge", this._bridgeid, ": closed manually");

    this._closed = true;
    this.socket.close();
  }

  async createIPCPort(name, global)
  {
    let port = null;

    // Generate new (negative) id
    --this.nextid;

    await this._sendMessage({ type: "createlistenport", id: this.nextid, name: name, global: global }, res =>
    {
      // Synchronous registration at incoming message time. Errors can be handled asynchronously
      port = new IPCListenerPort();
      this.ports.push({ id: res.id, port: port });
    });

    return port;
  }

  async connectIPCPort(name,global)
  {
    let link = null;

    // Generate new (negative) id
    --this.nextid;

    await this._sendMessage({ type: "connectport", id: this.nextid, name:name, global:!!global, managed: global === "managed" }, res =>
    {
      // Synchronous registration at incoming message time. Errors can be handled asynchronously
      link = new IPCLink(this, res.id);
      this.links.push({ id: res.id, link: link });
    });

    return link;
  }

  invoke(library, functionname, ...args)
  {
    return this._sendMessage({ type: "invoke", lib: library, func: functionname, args: args });
  }

  async openWebHareService(name, ...args)
  {
    let link = await this.connectIPCPort("webhareservice:" + name, true);
    let description = await link.doRequest({ __new: args });
    return new WebHareServiceWrapper(link, description);
  }

  broadcastEvent(event, data)
  {
    this._send({ type: "broadcast", event: event, data: data || {} });
  }

  async registerMultiEventCallback(event, callback)
  {
    // Generate new (negative) id
    let id = --this.nextid;

    await this._sendMessage({ type: "registermultieventcallback", id: id, event: event }, () =>
    {
      this.eventcallbacks.push({ id: id, callback: callback });
    });
    return { id: id };
  }

  /** Returns the trace of an exception in a structured format compatible with Harescript traces
      @param e Exception
      @return
      @cell return.filename
      @cell return.line
      @cell return.col
      @cell return.func
  */
  getStructuredTrace(e)
  {
    var trace = stacktrace_parser.parse(e.stack);
    return trace.map(i => ({ filename: i.file || "", line: i.lineNumber || 1, col: i.column || 1, func: i.methodName || "" }));
  }
}

module.exports = new WebHareBridge;
