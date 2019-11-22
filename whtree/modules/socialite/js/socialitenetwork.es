const EventEmitter = require('events');
const Cookie = require('@mod-system/js/compat/cookie');

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
