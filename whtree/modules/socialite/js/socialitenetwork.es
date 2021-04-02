const EventEmitter = require('events');

function escapeRegExp(xx)
{
  return xx.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
}

//based on mootools cookie
class Cookie
{
  constructor(key,options)
  {
    if(!options)
      options={};

    this.key = key;
    this.options = { path: 'path' in options ? options.path :  '/'
                   , domain: 'domain' in options ? options.domain : false
                   , duration: 'duration' in options ? options.duration : false
                   , secure: 'secure' in options ? options.secure : false
                   , document: 'document' in options ? options.document : document
                   , encode: 'encode' in options ? options.encode : true
                   , httpOnly: 'httpOnly' in options ? options.httpOnly : false
                   };
  }
  write(value)
  {
    if (this.options.encode)
      value = encodeURIComponent(value);
    if (this.options.domain)
      value += '; domain=' + this.options.domain;
    if (this.options.path)
      value += '; path=' + this.options.path;
    if (this.options.duration)
    {
      var date = new Date();
      date.setTime(date.getTime() + this.options.duration * 24 * 60 * 60 * 1000);
      value += '; expires=' + date.toGMTString();
    }
    if (this.options.secure)
      value += '; secure';
    if (this.options.httpOnly)
      value += '; HttpOnly';
    this.options.document.cookie = this.key + '=' + value;
    return this;
  }
  read()
  {
    var value = this.options.document.cookie.match('(?:^|;)\\s*' + escapeRegExp(this.key) + '=([^;]*)');
    return (value) ? decodeURIComponent(value[1]) : null;
  }
  dispose()
  {
    new Cookie(this.key, Object.assign({}, this.options, {duration: -1})).write('');
    return this;
  }
}

Cookie.write = function(key, value, options)
{
  return new Cookie(key, options).write(value);
};

Cookie.read = function(key)
{
  return new Cookie(key).read();
};

Cookie.dispose = function(key, options)
{
  return new Cookie(key, options).dispose();
};

class SocialiteNetwork extends EventEmitter
{
  constructor(appid)
  {
    super();
    this.appid = appid;
    this.socialitetoken = '';
    this.gotlogincompletion = true;
  }
  openLoginDialog(onaccept, ondeny, options)
  {
    this.gotlogincompletion=false;
    if(!this.appid)
    {
      console.log("No appid was specified for this network, so a login dialog cannot be opened");
      return;
    }

    this.cbid = (new Date-0);
    this.logincallback = this.__onLoginCallback.bind(this, onaccept, ondeny);

    var cbname = '__socialitecallback' + (this.cbid);
    window[cbname] = this.logincallback;
    var authurl = '/tollium_todd.res/socialite/auth.shtml'
                  + '?app=' + encodeURIComponent(this.appid)
                  + '&dd=' + encodeURIComponent(document.domain)
                  + '&sq=' + this.cbid;
    if(options && options.permissions && options.permissions.length)
      authurl += '&p=' + encodeURIComponent(options.permissions.join('||'));

    this.cbwindow = window.open(authurl);
    this.cbwaiter = window.setInterval(this.__pollCookie.bind(this), 200);
  }
  __pollCookie()
  {
    var token = Cookie.read('socialite_cb_' + this.cbid);
    if(!token)
      return;

    if(token)
      this.logincallback(token)
  }
  __onLoginCallback(onaccept, ondeny, securetoken)
  {
    if(this.cbwaiter)
    {
      window.clearInterval(this.cbwaiter);
      this.cbwaiter=null;
    }
    Cookie.dispose('socialite_cb_' + this.cbid); //make sure any confriamtion cookie is gone

    try
    {
      this.cbwindow.close();
    }
    catch(e)
    {

    }
    if(this.gotlogincompletion)
      return;

    this.gotlogincompletion=true;
    if(securetoken && securetoken!='-fail-')
    {
      if(onaccept)
      {
        this.socialitetoken = securetoken;
        onaccept( { target:this
                  , socialitetoken: this.socialitetoken
                  });
      }
    }
    else if(ondeny)
    {
      ondeny ( { target:this });
    }
  }
}

module.exports = SocialiteNetwork;
