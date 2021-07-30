//ADDME move cookie state to sessionstorage, we don't need to transmit _c cookies on each request

import * as dompack from 'dompack';
import * as domcookie from 'dompack/extra/cookie';
import * as whintegration from '@mod-system/js/wh/integration';
import Keyboard from 'dompack/extra/keyboard';

import JSONRPC from '@mod-system/js/net/jsonrpc';

var defaultauth = null;

function getBackVar(backurl)
{
  backurl = backurl.split('/').slice(3).join('/'); //strip origin, make relative to current server
  return backurl ? '?b=' + encodeURIComponent(backurl) : '';
}

function getURLOrigin(url)
{
  return url.split('/').slice(0,3).join('/');
}

class WRDAuthenticationProvider
{
  constructor(options)
  {
    if(!options)
      options={};

    this.cookiename = 'cookiename' in options ? options.cookiename : "webharelogin";
    this.samlidpreq = 'samlidpreq' in options ? options.samlidpreq : '';

    this.refresh();
  }

  refresh()
  {
    this.isloggedin = false;
    this.userinfo = null;
    this.logouturl = "";
    this.loginservice = new JSONRPC( { url: '/wh_services/wrd/auth' + (dompack.debugflags.aut ? "?wh-debug=aut" : "" )});

    var jsstate = domcookie.read(this.cookiename + '_j');
    var currentstate = domcookie.read(this.cookiename + '_c');

    if(dompack.debugflags.aut)
    {
      console.log("[aut] " + this.cookiename + "_j=" + jsstate);
      console.log("[aut] " + this.cookiename + "_c=" + currentstate);
    }
    if(!jsstate)
      return;

    if(!currentstate || currentstate.substr(0, jsstate.length) != jsstate)
    {
      location.replace('/.wrd/auth/restoresession.shtml' + getBackVar(location.href));
      return;
    }
    else
    {
      if(dompack.debugflags.aut)
        console.log("[aut] looks like we're still logged in");

      this.isloggedin = true;
      if(currentstate.length > 1)
        try
        {
          this.userinfo = JSON.parse(currentstate.substr(jsstate.length));
        }
        catch(e)
        {
        }
    }
  }

  //Get the current session id - use this if you need to discard settings
  getCurrentSessionId()
  {
    return domcookie.read(this.cookiename + '_j') || '';
  }

  logout()
  {
    let backurl = location.href;
    if(this.logouturl)
    {
      let logouturl = new URL(this.logouturl, backurl).toString();
      if(getURLOrigin(backurl) != getURLOrigin(logouturl))
        throw new Error("A logout URL is not allowed to change the origin"); //we won't be an open redirect. and getBackVar will clear the origin anyway

      backurl = logouturl;
    }

    let redirectto = '/.wrd/auth/logout.shtml' + getBackVar(backurl);
    location.replace(redirectto);
  }

  setupLoginForm(form)
  {
    if(!form)
      throw new Error("No such form");

    new Keyboard(form, { "Enter": evt => this._handleLoginForm(form, evt) });
    form.addEventListener("submit", evt => this._handleLoginForm(form, evt));
    form.addEventListener("click", evt => this._handleLoginClick(form, evt));
  }
  _handleLoginClick(form, event)
  {
    if(dompack.closest(event.target, '.wh-wrdauth__loginbutton'))
      return this._handleLoginForm(form, event); //will stop the event too
  }
  _handleLoginForm(form, event)
  {
    dompack.stop(event);

    var loginfield = form.querySelector('*[name="login"]');
    var passwordfield = form.querySelector('*[name="password"]');
    var persistentfield = form.querySelector('*[name="persistent"]');

    if(!loginfield)
      throw new Error("No field named 'login' found");
    if(!passwordfield)
      throw new Error("No field named 'password' found");

    var persistentlogin = persistentfield && persistentfield.checked;
    this._tryLogin(form, loginfield.value, passwordfield.value, { persistent: persistentlogin });
  }
  login(login, password, options)
  {
    options = {...options};
    return new Promise( (resolve, reject) =>
    {
      var url = new URL(location.href);

      var opts =
        { challenge:    url.searchParams.get("wrdauth_challenge") || ""
        , returnto:     url.searchParams.get("wrdauth_returnto") || ""
        , samlidpreq:   this.samlidpreq
        };

      return this.loginservice.request('Login'
                                       , [ location.href
                                         , login
                                         , password
                                         , Boolean(options.persistent)
                                         , opts
                                         ]
                                       , function(response)
                                         { //success handler
                                           resolve(response);
                                         }
                                       , function(error)
                                         {
                                           reject(error);//FIXME translate to exception
                                         }
                                       );
    });
  }

  loginSecondFactor(loginproof, type, data, options)
  {
    return new Promise( (resolve, reject) =>
    {
      var url = new URL(location.href);

      var opts =
        { challenge:    url.searchParams.get("wrdauth_challenge") || ""
        , returnto:     url.searchParams.get("wrdauth_returnto") || ""
        , samlidpreq:   this.samlidpreq
        };

      return this.loginservice.request('LoginSecondFactor'
                                       , [ location.href
                                         , loginproof
                                         , Boolean(options.persistent)
                                         , type
                                         , { ...data}
                                         , opts
                                         ]
                                       , function(response)
                                         { //success handler
                                           resolve(response);
                                         }
                                       , function(error)
                                         {
                                           reject(error);//FIXME translate to exception
                                         }
                                       );
    });
  }

  //ADDME do we have direct callers or can we _tryLogin this?
  //FIXME be more wh-form like, at least BEM the 'submitting' class
  _tryLogin(form, login, password, options)
  {
    let loginlock = dompack.flagUIBusy();
    if(form)
      form.classList.add("submitting");

    this.login(login, password, options).then( result => this.onLoginSuccess(loginlock, form, result) )
              .catch( error => this._onLoginFailure(loginlock, form, options, error));
  }
  onLoginSuccess(loginlock, form, response)
  {
    if(form)
      form.classList.remove("submitting");

    let completion = () => this._completeLoginSuccess(loginlock, response, form);
    dompack.dispatchCustomEvent(form || document.documentElement, 'wh:wrdauth-onlogin',
                                { bubbles: true
                                , cancelable: true
                                , detail: { callback: completion, userinfo: response.userinfo }
                                , defaulthandler: completion
                                });
  }
  _completeLoginSuccess(loginlock, response, form)
  {
    loginlock.release();
    if(response.success)
    {
      if (response.submitinstruction)
      {
        whintegration.executeSubmitInstruction(response.submitinstruction);
        return;
      }

      //The user has succesfully logged in
      location.reload(true);
      return;
    }

    this._failLogin(/* FIXME? Locale.get('wh-common.authentication.loginfail') || */'The specified login data is incorrect.', response, form);
  }
  _onLoginFailure(loginlock, form, options, code, msg)
  {
    if(form)
      form.classList.remove("submitting");
    loginlock.release();

    this._failLogin(/* FIXME? Locale.get('wh-common.authentication.loginerror') || */'An error has occurred.', { code: code }, form);
  }
  _failLogin(message, response, form)
  {
    let evtdetail = { message: message
                    , code: response.code
                    , data: response.data
                    };

    let cancelled = !dompack.dispatchCustomEvent(form || document.documentElement, "wh:wrdauth-loginfailed", { bubbles: true, cancelable: true, detail: evtdetail });
    if(!cancelled)
    {
      /*
      if($wh.Popup && $wh.Popup.Dialog)
        new $wh.Popup.Dialog( { text: failevent.message, buttons: [{ result: 'ok', title: "Ok" }] });
      else*/
        alert(message);
    }
  }
  isLoggedIn()
  {
    return this.isloggedin;
  }
  getUserInfo()
  {
    return this.userinfo;
  }
  setLogoutURL(url)
  {
    this.logouturl = url;
  }

  startLogin(type, sp_tag, options)
  {
    options = options || {};
    var defer = dompack.createDeferred();

    this.loginservice.request('StartLogin'
                              , [ type, sp_tag, location.href, options ]
                              , defer.resolve
                              , defer.reject //FIXME translate to exception
                              );

    return defer.promise;
  }
  startSAMLLogin(sp_tag, options)
  {
    return this.startLogin('saml', sp_tag, options);
  }

  //Setup the page with loginstate. automatically invoked on the default auth provider
  setupPage()
  {
    document.documentElement.classList.toggle("wh-wrdauth-loggedin", this.isLoggedIn()); //legacy! will be removed
    document.documentElement.classList.toggle("wh-wrdauth--isloggedin", this.isLoggedIn());
  }
}

WRDAuthenticationProvider.getDefaultAuth = function()
{
  return defaultauth;
};

if(dompack.debugflags.aut)
{
  var debuginfo = domcookie.read("wh-wrdauth-debug");
  if(debuginfo)
    debuginfo.split('\t').forEach( msg => console.warn("[aut] server: " + msg));
  domcookie.remove("wh-wrdauth-debug");
}

if(window.$wh && window.$wh.WRDAuthenticationProvider)
{
  console.log("Both designfiles wrd.auth and @mod-wrd/js/auth are loaded. @mod-wrd/js/auth will not activate");
}
else if(whintegration.config["wrd:auth"])
{
  defaultauth = new WRDAuthenticationProvider(whintegration.config["wrd:auth"]);
  defaultauth.setupPage();

  dompack.register('.wh-wrdauth__logout, .whplugin-wrdauth-logout', node =>
  {
    node.whplugin_processed = true;
    node.addEventListener("click", event =>
    {
      event.stopPropagation();
      event.preventDefault();
      defaultauth.logout();
    });
  });
  dompack.register('.wh-wrdauth__loginform, .whplugin-wrdauth-loginform', node =>
  {
    node.whplugin_processed = true;
    defaultauth.setupLoginForm(node);
  });

  if(defaultauth.userinfo)
  {
    dompack.register("*[data-wrdauth-text]", node =>
    {
      var elname = node.dataset.wrdauthText;
      if(elname in defaultauth.userinfo)
        node.textContent = defaultauth.userinfo[elname];
    });
    dompack.register("*[data-wrdauth-value]", node =>
    {
      var elname = node.dataset.wrdauthValue;
      if(elname in defaultauth.userinfo)
        node.value = defaultauth.userinfo[elname];
    });
  }
}

module.exports = WRDAuthenticationProvider;
