/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

//ADDME move cookie state to sessionstorage, we don't need to transmit _c cookies on each request

import * as dompack from 'dompack';
import * as domcookie from 'dompack/extra/cookie';
import * as whintegration from '@mod-system/js/wh/integration';
import * as newauth from "@webhare/frontend/src/auth";
import Keyboard from 'dompack/extra/keyboard';

import JSONRPC from '@mod-system/js/net/jsonrpc';
import { navigateTo } from '@webhare/env';
import { isHTMLElement } from '@webhare/dompack';

let defaultauth: WRDAuthenticationProvider | null = null;

function getBackVar(backurl) {
  backurl = backurl.split('/').slice(3).join('/'); //strip origin, make relative to current server
  return backurl ? '?b=' + encodeURIComponent(backurl) : '';
}

function getURLOrigin(url) {
  return url.split('/').slice(0, 3).join('/');
}

export class WRDAuthenticationProvider {
  userinfo: object | null = null;
  constructor(options) {
    if (!options)
      options = {};

    this.cookiename = 'cookiename' in options ? options.cookiename : "webharelogin";

    this.refresh();

    window.$wh$legacyAuthProvider = this; //@webhare/frontend/src/auth needs this to keep us in sync
  }

  refresh() {
    this.isloggedin = false;
    this.userinfo = newauth.getUserInfo();
    this.logouturl = "";
    this.loginservice = new JSONRPC({ url: '/wh_services/wrd/auth' });

    const jsstate = domcookie.read(this.cookiename + '_j');
    const currentstate = domcookie.read(this.cookiename + '_c');

    if (dompack.debugflags.aut) {
      console.log("[aut] " + this.cookiename + "_j=" + jsstate);
      console.log("[aut] " + this.cookiename + "_c=" + currentstate);
    }
    if (!jsstate)
      return;

    if (!currentstate || currentstate.substr(0, jsstate.length) !== jsstate) {
      return;
    } else {
      if (dompack.debugflags.aut)
        console.log("[aut] looks like we're still logged in");

      this.isloggedin = true;
      if (currentstate.length > 1)
        try {
          this.userinfo = JSON.parse(currentstate.substr(jsstate.length));
        } catch (e) {
        }
    }
  }

  //Get the current session id - use this if you need to discard settings
  getCurrentSessionId() {
    return domcookie.read(this.cookiename + '_j') || '';
  }

  logout() {
    let backurl = location.href;
    if (this.logouturl) {
      const logouturl = new URL(this.logouturl, backurl).toString();
      if (getURLOrigin(backurl) !== getURLOrigin(logouturl))
        throw new Error("A logout URL is not allowed to change the origin"); //we won't be an open redirect. and getBackVar will clear the origin anyway

      backurl = logouturl;
    }

    const redirectto = '/.wrd/auth/logout.shtml' + getBackVar(backurl);
    location.replace(redirectto);
  }

  setupLoginForm(form: HTMLFormElement) {
    if (!form)
      throw new Error("No such form");

    new Keyboard(form, { "Enter": evt => this._handleLoginForm(form, evt) });
    form.addEventListener("submit", evt => this._handleLoginForm(form, evt));
    form.addEventListener("click", evt => this._handleLoginClick(form, evt));
  }
  _handleLoginClick(form: HTMLFormElement, event: MouseEvent) {
    if (form.hasAttribute("data-wh-wrdauth-attached"))
      return; //get out of the way - modern handlers are registered

    if (isHTMLElement(event.target) && event.target.closest('.wh-wrdauth__loginbutton'))
      return this._handleLoginForm(form, event); //will stop the event too
  }
  _handleLoginForm(form: HTMLFormElement, event: Event) {
    if (form.hasAttribute("data-wh-wrdauth-attached"))
      return; //get out of the way - modern handlers are registered

    dompack.stop(event);

    const loginfield = form.querySelector('*[name="login"]');
    const passwordfield = form.querySelector('*[name="password"]');
    const persistentfield = form.querySelector('*[name="persistent"]');

    if (!loginfield)
      throw new Error("No field named 'login' found");
    if (!passwordfield)
      throw new Error("No field named 'password' found");

    const persistentlogin = persistentfield && persistentfield.checked;
    this._tryLogin(form, loginfield.value, passwordfield.value, { persistent: persistentlogin });
  }

  login(login, password, options) {
    options = { ...options };
    return new Promise((resolve, reject) => {
      const url = new URL(location.href);

      const opts =
      {
        logincontrol: url.searchParams.get("wrdauth_logincontrol") || ""
      };

      return this.loginservice.request('Login'
        , [
          location.href,
          login,
          password,
          Boolean(options.persistent),
          opts
        ]
        , function (response) { //success handler
          resolve(response);
        }
        , function (error) {
          reject(error);//FIXME translate to exception
        }
      );
    });
  }

  loginSecondFactor(loginproof, type, data, options) {
    return new Promise((resolve, reject) => {
      const url = new URL(location.href);

      const opts =
      {
        logincontrol: url.searchParams.get("wrdauth_logincontrol") || ""
      };

      return this.loginservice.request('LoginSecondFactor'
        , [
          location.href,
          loginproof,
          type,
          { ...data },
          opts
        ]
        , function (response) { //success handler
          resolve(response);
        }
        , function (error) {
          reject(error);//FIXME translate to exception
        }
      );
    });
  }

  /** Get the afterlogin submitinstruction from the wrdauth_logincontrol webvariable
      @cell(string) opts.logincontrol Override wrdauth_logincontrol variable from the url
      @return Submit instruction. The defult instruction is { "type": "reload" }.
  */
  getAfterLoginSubmitInstruction(opts = {}) {
    const url = new URL(location.href);
    const logincontrol = opts.logincontrol || url.searchParams.get("wrdauth_logincontrol") || "";

    return new Promise((resolve, reject) => {
      this.loginservice.request('getAfterLoginSubmitInstruction',
        [location.href, logincontrol],
        function (response) { //success handler
          resolve(response);
        }
        , function (error) {
          reject(error);//FIXME translate to exception
        }
      );
    });
  }

  //ADDME do we have direct callers or can we _tryLogin this?
  //FIXME be more wh-form like, at least BEM the 'submitting' class
  _tryLogin(form, login, password, options) {
    const loginlock = dompack.flagUIBusy();
    if (form)
      form.classList.add("submitting");

    this.login(login, password, options).then(result => this.onLoginSuccess(loginlock, form, result))
      .catch(error => this._onLoginFailure(loginlock, form, options, error));
  }
  onLoginSuccess(loginlock, form, response) {
    if (form)
      form.classList.remove("submitting");

    const completion = () => this._completeLoginSuccess(loginlock, response, form);
    dompack.dispatchCustomEvent(form || document.documentElement, 'wh:wrdauth-onlogin',
      {
        bubbles: true,
        cancelable: true,
        detail: { callback: completion, userinfo: response.userinfo },
        defaulthandler: completion
      });
  }
  _completeLoginSuccess(loginlock, response, form) {
    loginlock.release();
    if (response.success) {
      if (response.submitinstruction) {
        navigateTo(response.submitinstruction);
        return;
      }

      //The user has succesfully logged in
      console.log("Reloading after succesfull login");
      navigateTo({ type: "reload" });
      return;
    }

    this._failLogin(/* FIXME? Locale.get('wh-common.authentication.loginfail') || */'The specified login data is incorrect.', response, form);
  }
  _onLoginFailure(loginlock, form, options, code, msg) {
    if (form)
      form.classList.remove("submitting");
    loginlock.release();

    this._failLogin(/* FIXME? Locale.get('wh-common.authentication.loginerror') || */'An error has occurred.', { code: code }, form);
  }
  _failLogin(message, response, form) {
    if (["REQUIRESETUPSECONDFACTOR", "FAILEDVALIDATIONCHECKS", "REQUIRESECONDFACTOR"].includes(response.code)) {
      console.error(`Code "${response.code}" is NOT supported by @mod-wrd/js/auth - you will need to remove this library and fully switch to setupAuth in @webhare/frontend to support password requirements and/or MFA`);
      message = "An internal error has occured in the account management system. Please contact the webmaster.";
    }

    const evtdetail = {
      message: message,
      code: response.code,
      data: response.data
    };

    const cancelled = !dompack.dispatchCustomEvent(form || document.documentElement, "wh:wrdauth-loginfailed", { bubbles: true, cancelable: true, detail: evtdetail });
    if (!cancelled) {
      /*
      if($wh.Popup && $wh.Popup.Dialog)
        new $wh.Popup.Dialog( { text: failevent.message, buttons: [{ result: 'ok', title: "Ok" }] });
      else*/
      alert(message);
    }
  }
  isLoggedIn() {
    return newauth.isLoggedIn();
  }
  /** @deprecated Switch to frontend getUserInfo() */
  getUserInfo(): any {
    return newauth.getUserInfo();
  }
  setLogoutURL(url) {
    this.logouturl = url;
  }

  startLogin(type, sp_tag, options) {
    options = options || {};
    const defer = Promise.withResolvers();

    this.loginservice.request('StartLogin'
      , [type, sp_tag, location.href, options]
      , defer.resolve
      , defer.reject //FIXME translate to exception
    );

    return defer.promise;
  }
  startSAMLLogin(sp_tag, options) {
    return this.startLogin('saml', sp_tag, options);
  }

  //Setup the page with loginstate. automatically invoked on the default auth provider
  setupPage() {
    document.documentElement.classList.toggle("wh-wrdauth-loggedin", this.isLoggedIn()); //legacy! will be removed
    document.documentElement.classList.toggle("wh-wrdauth--isloggedin", this.isLoggedIn());
  }

  static getDefaultAuth() {
    return defaultauth;
  }
}

export function getDefaultAuth() {
  return defaultauth;
}

if (window.$wh && window.$wh.WRDAuthenticationProvider) {
  console.log("Both designfiles wrd.auth and @mod-wrd/js/auth are loaded. @mod-wrd/js/auth will not activate");
} else if (whintegration.config["wrd:auth"]) {
  defaultauth = new WRDAuthenticationProvider(whintegration.config["wrd:auth"]);
  defaultauth.setupPage();

  dompack.register('.wh-wrdauth__logout, .whplugin-wrdauth-logout', node => {
    node.whplugin_processed = true;
    node.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      defaultauth.logout();
    });
  });
  dompack.register('.wh-wrdauth__loginform, .whplugin-wrdauth-loginform', node => {
    node.whplugin_processed = true;
    defaultauth.setupLoginForm(node);
  });

  if (defaultauth.userinfo) {
    dompack.register("*[data-wrdauth-text]", node => {
      const elname = node.dataset.wrdauthText;
      if (elname in defaultauth.userinfo)
        node.textContent = defaultauth.userinfo[elname];
    });
    dompack.register("*[data-wrdauth-value]", node => {
      const elname = node.dataset.wrdauthValue;
      if (elname in defaultauth.userinfo)
        node.value = defaultauth.userinfo[elname];
    });
  }
}

export default WRDAuthenticationProvider;

window.$wh$wrdauth = true; //flag our load - needed during transition to @webhare/wrdauth to prevent double loading
