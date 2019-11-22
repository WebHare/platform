const InternetRequester = require('./requester');

class EventServerConnection extends InternetRequester
{
  constructor(options)
  {
    if(!options)
      options={};

    super(options);
    this.options.url = options.url || '';  //Host url of event server
    this.options.waitlength= options.waitlength || 4*60;

      // Last seen server ID
    this.serverId = '';

      // Current subscribed groups
    this.groups = [];

      // Last id per group (unsubscribed groups are reset)
    this.lastIds = {};

      // Active?
    this.active = false;

      // Broadcasting?
    this.broadcasting = false;

      // Have response yet?
    this.have_response = false;

      // Currently pending broadcasts
    this.broadcasts = [];

      // timeout
    this.timeout = null;

      // Cache defeat
    this.cachecounter = 0;

      // Date of last request
    this.lastrequest = null;

      // Date of last response
    this.lastresponse = null;

      // Last error message
    this.lasterrormessage = '';

      /* Override for wait length. Doubled at every receive of timeout response. Starts
         at 35 seconds, some devices (Galaxy Tab 7) disconnect after 33 secs. Timeout is
         maxed by options.waitlength.
      */
    this.waitlengthoverride = 35;

    this.on("requestend", this.onResponse.bind(this));
  }

  destroy()
  {
    this.stop();
  }

  destroyConn()
  {
    this.stopCurrentRequest();
  }

  /// Set groups
  setGroups(groups)
  {
    // Gather last ids from all surviving groups
    var newLastIds = {};
    for (var i = 0, e = groups.length; i < e; ++i)
    {
      var groupid = groups[i];
      newLastIds[groupid] = this.lastIds[groupid];
    }

    this.groups = groups;
    this.lastIds = newLastIds;

    if (this.options.log)
      console.log('EventServer: Subscribed to groups: ' + groups);

    this.scheduleRequest();
  }

  /// Start communication
  start()
  {
    if(this.active)
      return;

    if (this.options.log)
      console.log('EventServer: Starting');

    this.active = true;
    this.scheduleRequest();
  }

  /// (Temporarily) suspend communication (broadcast may continue). Restart with start. Not tested.
  suspend()
  {
    if (this.options.log)
      console.log('EventServer: Suspending');

    this.active = false;
    if (!this.broadcasting)
    {
      this.destroyConn();
      this.stopCurrentRequest();
    }
  }

  /// Stop communication (kills everyting)
  stop()
  {
    if (this.options.log)
      console.log('EventServer: Stopping');

    this.destroyConn();
    this.stopCurrentRequest();

    if (this.timeout)
      clearTimeout(this.timeout);

    this.active = false;
    this.broadcasting = false;
    this.have_response = false;
    this.broadcasts = [];
  }

  broadcastMessage(msg, group, token, options)
  {
    if (!group)
      throw new Error("No group set");
    if (!token)
      throw new Error("No valid write token set");

    // Store all data in the options
    options = { maxretries: 2
              , ...options
              , msg: msg
              , group: group
              , token: token
              };
    ++options.maxretries;

    this.broadcasts.push(options);

    this.scheduleRequest();
  }

  /// Returns date of last response
  getLastResponseDate()
  {
    return this.lastresponse;
  }

  addURLparam(url, name, value)
  {
    url += url.indexOf('?') >= 0 ? '&' : '?';
    return url + encodeURIComponent(name) + '=' + encodeURIComponent(value);
  }

  getGroupListenURL()
  {
    if (this.waitlengthoverride)
    {
      if (this.waitlengthoverride > this.options.waitlength)
      {
        if (this.options.log)
          console.log('EventServer: override timeout not needed anymore');
        this.waitlengthoverride = 0;
      }
      else if (this.options.log)
        console.log('EventServer: override timeout to ', this.waitlengthoverride);
    }
    else if (this.options.log)
      console.log('EventServer: no override timeout');

    var timeout = this.waitlengthoverride || this.options.waitlength;

    var url = this.options.url;
    var groups = '';
    for (var i = 0, e = this.groups.length; i != e; ++i)
    {
      if (i != 0)
        groups += ',';

      var groupid = this.groups[i];
      groups += groupid + '/' + (this.lastIds[groupid] || 0);
    }
    url = this.addURLparam(url, 'groups', groups);
    url = this.addURLparam(url, 'timeout', timeout);
    if (this.serverId)
      url = this.addURLparam(url, 'sid', this.serverId);
    return url;
  }

  scheduleRequest()
  {
    if (this.options.log)
      console.log('EventServer: scheduleRequest');

    // If currently broadcasting, wait for it to finish
    if (this.broadcasting)
    {
      if (this.options.log)
        console.log('EventServer: scheduleRequest aborting, already broadcasting');
      return;
    }

    if (!this.active)
    {
      if (this.options.log)
        console.log('EventServer: scheduleRequest aborting, not active');
      this.stopCurrentRequest();
      return;
    }

    var broadcast = null;
    if (this.broadcasts.length)
      broadcast = this.broadcasts.shift();

    this.restartRequest(broadcast);
  }

  restartRequest(broadcast)
  {
    if (broadcast && --broadcast.maxretries)
      broadcast = null;

    if (this.options.log)
      console.log('EventServer: restartRequest', broadcast, this.active);

    this.stopCurrentRequest();

    if (!broadcast && !this.active)
    {
      if (this.options.log)
        console.log('EventServer: restartRequest aborting');
      return;
    }


    var url = '';

    if (broadcast)
    {
      url = this.options.url;

      url = this.addURLparam(url, 'postgroup', broadcast.group);
      url = this.addURLparam(url, 'token', broadcast.token);
      if (broadcast.tag && typeof broadcast.tag == "string")
        url = this.addURLparam(url, 'tag', broadcast.tag);
      if (broadcast.ttl && typeof broadcast.ttl == "number")
        url = this.addURLparam(url, 'ttl', broadcast.ttl);

      if (this.lasterrormessage)
        url = this.addURLparam(url, 'lasterror', this.lasterrormessage);
      this.have_response = false;
    }
    else
    {
      // No need to schedule
      if (this.groups.length == 0)
        return;

      url = this.getGroupListenURL();
      url = this.addURLparam(url, 'lasterror', this.lasterrormessage);
    }

    try
    {
      this.currentbroadcast = broadcast;

      if (this.options.log)
        console.log('Eventserver: do request:', broadcast?'post':'get', url);

      this.startXMLHTTPRequest(broadcast?"post":"get", url, broadcast?broadcast.msg:null);
      this.lastrequest = new Date();

      if (this.timeout)
        clearTimeout(this.timeout);
      this.timeout = setTimeout( () => this.restartRequest(broadcast), (this.options.waitlength + 10) * 1000);
    }
    catch(e)
    {
      if (this.options.log)
        console.log('exception', e.message);
      return;
    }

    if (broadcast)
      this.broadcasting = true;
  }

  onLoadEnd(event)
  {
    this.onResponse(event);
  }

  onResponse(event)
  {
    this.have_response = true;

    if (event.success)
    {
      var decoded = event.responsejson;

      // Update last response date (not when broadcasting, though)
      if (!this.currentbroadcast)
        this.lastresponse = new Date();

      if (decoded)
        this.handleReceivedResponse(decoded);
      else
        this.handleRequestError(this.currentbroadcast, { message: 'decodeerror' });
    }
    else
      this.handleRequestError(this.currentbroadcast, event);
  }

  handleReceivedResponse(decoded)
  {
    this.broadcasting = false;
    this.lasterrormessage = '';

    if (decoded)
    {
      if (this.options.log)
        console.log('EventServer: got response');
      this.serverId = decoded.srvid;

      if (this.timeout)
        clearTimeout(this.timeout);

      if (decoded.msgs.length)
      {
        for (var i = 0, e = this.groups.length; i < e; ++i)
          this.lastIds[this.groups[i]] = decoded.lid;

        var time = decoded.time;
        if (time < 1000000000000) // Still in seconds format?
          time *= 1000;

        if (this.options.log)
          console.log('EventServer: got messages: ', decoded.msgs);
        setTimeout( () => this.emit('data', { target: this, msgs: decoded.msgs, time: new Date(time) }));
      }
      else
      {
        // Got a timeout response, double the wait length override
        this.waitlengthoverride *= 2;
      }
    }
    else
      console.error('EventServer: Got empty response from eventserver');

    if (this.options.log)
      console.log('EventServer: rescheduling');
    this.scheduleRequest();
  }

  handleRequestError(broadcastdata, event)
  {
    if (this.options.log)
      console.log('EventServer: got error: ' + event.message);

    this.broadcasting = false;
    this.lasterrormessage = event.message;

    if (this.timeout)
      clearTimeout(this.timeout);

    // Retry after 7 seconds. But if the previous request had been running for more than 30 secs, restart immediately
    // (workaround for Galaxyx Tab 7 disconnecting after 33 secs)
    var timeout = 7000;
    if ((new Date() - this.lastrequest) >= 30 * 1000)
      timeout = 1;

    this.timeout = setTimeout( () => this.restartRequest(broadcastdata), timeout);
  }
}

module.exports = EventServerConnection;
