/****************************************************************************************************************************
 *                                                                                                                          *
 *  TODD INITIALIZATION AND LOADER                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/

/* global $shell */

let todd_components = {};

import { components as FrameComponents } from './frame';
import { getComponents } from '@mod-tollium/webdesigns/webinterface/components';
import TolliumFeedbackAPI from '@mod-tollium/webdesigns/webinterface/js/feedback.es';
import LinkEndPoint from './comm/linkendpoint.es';
import TransportManager from './comm/transportmanager.es';

todd_components = { ...FrameComponents
                  , ...getComponents()
                  };

// for tests: this is the shortest test that's sufficient to open the Logoff window
// todd_components = { button: require("@mod-tollium/webdesigns/webinterface/components/button/button.es").default
//                   , text: require("@mod-tollium/webdesigns/webinterface/components/text/text.es").default
//                   , action: require("@mod-tollium/webdesigns/webinterface/components/action/action.es").default
//                   , panel: require("@mod-tollium/webdesigns/webinterface/components/panel/panel.es").default
//                   };


import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import * as domfocus from '@mod-system/js/dom/focus';
import * as whintegration from '@mod-system/js/wh/integration';
import './debugging/magicmenu';

var EventServerConnection = require('@mod-system/js/net/eventserver');
var WRDAuth = require('@mod-wrd/js/auth');
var JSONRPC = require('@mod-system/js/net/jsonrpc');
var MenuComponent = require('../components/basecontrols/menu');
import * as whconnect from '@mod-system/js/wh/connect';
import { setupWHCheck } from './shell/whcheck';

var $todd = require('./support');
require('./application');
require('./desktop');
require('./apps/dashboard');
require('./login');
require('./oauth');
require('../css/shell.css');
require('../css/apps.scss');
require('../skins/default/skin.scss');
require('../skins/default/controls.scss');
import "./loginrequests.es"; //process preview panel login requests
var toddImages = require("@mod-tollium/js/icons");
var domevents = require('@mod-system/js/dom/events');

require('@mod-system/js/compat/iefocusfix'); //it'll autorun, no need to use any export
import TowlNotifications from './shell/towl';

import { getTid } from "@mod-tollium/js/gettid";
require("../common.lang.json");

function getClosestValidFocusTarget(node)
{
  for(;node;node=node.parentNode)
    if(node.nodeName === 'LABEL' || domfocus.canFocus(node) || (node.classList && node.classList.contains('selectable')))
      return node;
  return null;
}

class IndyShell
{ constructor()
  {
    this.isloggingoff = false;
    this.istodd = false;
    this.eventsconnection = null;
    this.broadcaststart = null; //start of broadcasts. used to filter old messages
    this.isloggedin = false;
    this.checkinterval = 0;
    this.tolliumservice = null;
    this.offlinenotification = false;
    this.wrdauth = null;

    this.settings = {};

    this.wrdauth = WRDAuth.getDefaultAuth();

    $todd.resourcebase = new URL(whintegration.config.obj.toddroot, location.href).toString();
    this.eventsconnection = new EventServerConnection({ url: "/wh_events/"});
    this.eventsconnection.on("data", event => this.onBroadcastData(event));
    dompack.onDomReady(() => this.onDomReady());
    document.documentElement.addEventListener("tollium-shell:broadcast", evt => this.onBroadcast(evt));
    window.addEventListener("hashchange", evt => this._onHashChange(evt));
  }

  _onHashChange()
  {
    if(!location.hash.startsWith("#go="))
      return; //no support

    //Pass #go= url to the first started application (ADDME what if it's gone? this should currently only be used in combination with appbar-less applications. perhaps save the name of first forcedapp ?)
    if($todd.applications.length >= 1)
      $todd.applications[0].queueEvent("$appmessage", { message: { go: decodeURIComponent(location.hash.substr(4).split('&')[0]) }, onlynonbusy: false }, false);

    history.replaceState({}, null, location.href.split('#')[0]);
  }

  onDomReady()
  {
    if(!document.body) //early termination of load, eg wrdauth of whconnect redirect
      return;

    $todd.towl = new TowlNotifications(this);

    // Prevent menus (especially an application's main menu) from opening off the right side of the screen
    MenuComponent.setOptions(
        { horizbounds: document.body
        , allowscrollableview: true
        });

    //require("./tabs").setupfunction();

    this.continueLaunch();
  }

/****************************************************************************************************************************
 * External API
 */
  registerCustomAction(name,handler)
  {
    if($todd.customactions[name])
    {
      console.error("A handler for custom action '" + name + "' is already installed");
      return;
    }
    $todd.customactions[name]=handler;
  }

/****************************************************************************************************************************
 * Application management
 */

  startFrontendApplication(appname, parentapp, options)
  {
    var application = new $todd.FrontendEmbeddedApplication(this, appname, (options && options.target) || {}, parentapp, options);
    $todd.applications.push(application);

    application.loadApplication({ src: options.src
                                , baseobject: appname
                                });
    if(!options.inbackground && !parentapp)
      application.activateApp();

    return application;
  }
  startBackendApplication(appname, parentapp, options)
  {
    if(appname == '__jsapp_hack__') //FIXME proper way to start JS frontend apps
    {
      this.startFrontendApplication('TestJSApp', parentapp, {src:'/tollium_todd.res/webhare_testsuite/tollium/jsapp.js'});
      return;
    }

    $todd.towl.hideNotification("tollium:shell.frontendclose");

    let webvars=[], params = new URL(location.href).searchParams;
    for(let key of params.keys())
      webvars.push({name:key, value:params.get(key)});

    options = { ...options
              , frontendid: whintegration.config.obj.frontendid
              , shorttid: whintegration.config.obj.shorttid
              , params: whintegration.config.obj.appserviceparams
              , webvars: webvars
              , hasconnect: whconnect.hasConnect()
              };

    if(!options.isloginapp && location.hash.startsWith('#go='))
    {
      options.goparam = decodeURIComponent(location.hash.substr(4).split('&')[0]);
      history.replaceState({}, null, location.href.split('#')[0]);
    }

    var application = new $todd.BackendApplication(this, appname, (options && options.target) || {}, parentapp, options);
    $todd.applications.push(application);

    application.launchApp();
    if(!options.inbackground && !parentapp)
      application.activateApp();

    return application;
  }
  editPersonalSettings()
  {
    if(this.settings.personalsettings)
      this.executeInstruction(this.settings.personalsettings);
  }
  getApplicationById(id)
  {
    for(var i=0;i<$todd.applications.length;++i)
      if($todd.applications[i].whsid==id)
        return $todd.applications[i];
    return null;
  }

  registerApplicationFrontendLink(data)
  {
    // Register the frontend id
    var seenfrontend = $todd.frontendids.includes(data.frontendid);
    if(!seenfrontend)
      $todd.frontendids.push(data.frontendid);

    if(!seenfrontend) //FIXME should we register an endpoint if it wasn't an appstart? (what else could it be)? Decided to do it anyway, as the original code _did_ include the frontendid into $tdod.frontendids no matter what..
    {
      var metacomm = new LinkEndPoint({ linkid: data.linkid, commhost: data.commhost, frontendid: data.frontendid });
      metacomm.onmessage = this._gotMetaMessage.bind(this.shell);
      metacomm.onclosed = this._gotMetaClose.bind(this, data.frontendid);
      metacomm.register($todd.transportmgr);
    }
  }

/****************************************************************************************************************************
 * Component registration, creation and loading API
 */

  // If callback is not defined, loading new components is not allowed
  // Returns a list of unloaded components
  checkComponentsLoaded(compnames, callback)
  {
    var unloaded_components = [];
    compnames.forEach(item =>
    {
      if (!todd_components[item] && !unloaded_components.includes(item))
        unloaded_components.push(item);
    });

    if(unloaded_components.length > 0)
    {
      console.error("Unknown components: " + unloaded_components.join("; "));
    }
    return unloaded_components;
  }

  createComponent(type, parentcomp, data, replacingcomp)
  {
    if(todd_components[type])
      return new todd_components[type](parentcomp, data, replacingcomp);

    console.error('Unrecognized component type \'' + type + '\'');
    return null;
  }
  completeLogin(data, lock)
  {
    this.tolliumservice.request('CompleteLogin', [ data ],
      function(response) //onsuccess
      {
       location.reload(true);
      }.bind(this),
      function(err) //onfail
      {
        console.error(err);
        lock.release();
      });
  }

/****************************************************************************************************************************
 * Internal functions: framework bootup
 */
  continueLaunch()
  {
    this.tolliumservice = new JSONRPC(); //the shell will always talk back to the applicationportal that started it

    $todd.dummyimage = <img src="data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" />;
    if(browser.getName() == 'ie' && browser.getVersion()<=11)
      document.documentElement.classList.add('browser-ie11');

    // Initialize global event handlers
    window.addEventListener("dompack:movestart", this.onMovingUpdate.bind(this, true), true);
    window.addEventListener("dompack:moveend", this.onMovingUpdate.bind(this, false), true);
    window.addEventListener("unload", $todd.globalevents.OnUnload);
    window.addEventListener("selectstart", this.onSelectStart.bind(this));
    window.addEventListener("contextmenu", event => this.onContextMenuCapture(event), true);
    window.addEventListener("mousedown", event => this.onMouseDownFallback(event));
    window.addEventListener("click", event => this.onClick(event));

    window.addEventListener("dragover", evt => dompack.stop(evt));
    window.addEventListener("drop", evt => dompack.stop(evt));

    $todd.transportmgr = new TransportManager(
        { ononline: () => this._gotOnline()
        , onoffline: () => this._gotOffline()
        });

    var appbar = document.getElementById('t-apptabs');
    if(appbar)
      $todd.applicationBar = new $todd.ApplicationBar(this, appbar);

    $todd.registerJSApp('tollium:builtin.placeholder', PlaceholderApp);

    // Load the offline notification icon, so it can be shown when actually offline
    this.offlinenotificationicon = toddImages.createImage("tollium:messageboxes/warning", 24, 24, 'b');

    this.executeShell();
  }
  executeShell()
  {
    //Launch a placeholder app, simply to get 'something' up and running fast, and display the loader (otherwise we'd have to hack a special loader for 'no-apps')
    this.startuplock = dompack.flagUIBusy();
    this.placeholderapp = this.startFrontendApplication('tollium:builtin.placeholder', null, { onappbar: false });

    console.log("launching StartPortal and the shell");

    //This is the true shell. Ask the tollium shell what we need to do. Pass it any webvariables?
    var options = {};
    options.params = whintegration.config.obj.appserviceparams;
    this.tolliumservice.request('StartPortal', [ options, browser.getTriplet() ], this.gotPortal.bind(this), this.failPortal.bind(this));
  }
  gotPortal(data)
  {
    this.versioninfo = data.version;
    this.isloggedin = data.isloggedin;

    this.applyShellSettings(data.settings);
    setInterval( () => this.checkVersion(), 5*60*1000); //check for version updates etc every 5 minutes

    this.invitetype = (new URL(location.href)).searchParams.get("wrd_pwdaction");
    let runinviteapp = ["resetpassword"].includes(this.invitetype);

    if(runinviteapp || !data.isloggedin)
    {
      if(runinviteapp)
        this.loginapp = this.startBackendApplication("system:"+this.invitetype, null,
                                { onappbar:false
                                //, src: '/.tollium/ui/js/login.js'
                                //, target: data.loginconfig
                                , isloginapp: true
                                });
      else
        this.loginapp = this.startFrontendApplication("tollium:builtin.login", null,
                                { onappbar:false
                                , target: data.loginconfig
                                , isloginapp: true
                                });

      if(this.placeholderapp) //we can close it now
      {
        this.placeholderapp.terminateApplication();
        this.placeholderapp = null;
      }
      this.startuplock.release();
      return;
    }

    if(!this.dashboardapp && data.settings.dashboard)
      this.dashboardapp = this.startFrontendApplication('tollium:builtin.dashboard', null, { src: '/.tollium/ui/js/dashboard.js', fixedonappbar: true } );

    whintegration.config.obj.initialinstructions.forEach(instr => this.executeInstruction(instr));

    if(this.placeholderapp) //we can close it now
    {
      this.placeholderapp.terminateApplication();
      this.placeholderapp = null;
    }

    if(this.checkWasJustUpdated())
    {
      var notification = { id: -987654321
                         , timeout: 15000 //this is just a "why did we flash". if you weren't looking, not really relevant, so go away after 15 secs
                         , icon: "tollium:messageboxes/information"
                         , title: getTid("tollium:shell.webhareupdated")
                         , description: getTid("tollium:shell.webhareupdated_description")
                         };

      $todd.towl.showNotification(notification);
    }
    this.startuplock.release();
  }
  failPortal(response)
  {
    console.log(response);
    this.startuplock.release();
    alert("Portal startup failed"); //FIXME nicely handle this
  }
  onApplicationStackChange()
  {
    //if not app is open, open something. not sure about the best approach, we'll just try to activate the last app on the tab bar (The most recently opened one)
    if(!$todd.getActiveApplication() && $todd.applicationBar.apps.length > 0)
      $todd.applicationBar.apps.slice(-1)[0].app.activateApp();
  }
  onMovingUpdate(start, event)
  {
    document.documentElement.classList.toggle("moveInProgress", start);
  }
  onApplicationEnded(app)
  {
    if(this.isloggingoff) //do not interfere with the normal closing of apps
      return;

    if($todd.applications.length == 0) //no dashboard and no way to open an app?
    {
      if(this.invitetype)  //reload without invite vars
        location.href = location.href.split('?')[0];
      else if(this.settings.reloadonexit)
        location.reload();
      else
        window.close();
    }
    else if(!this.anyConnectedApplications())
    {
      this.checkVersion(); //poll for new version when all apps are closed
    }
  }

  doLogoff()
  {
    this.isloggingoff = true; //prevent dashboard etc from playing during a logoff

    while($todd.applications.length)
      $todd.applications[0].terminateApplication();

    this.wrdauth.logout();
  }
  requestNewShellSettings()
  {
    var options = {};
    options.params = whintegration.config.obj.appserviceparams;
    this.tolliumservice.request('GetCurrentShellSettings', [ options ], this.applyShellSettings.bind(this));
  }
  getCurrentSettings()
  {
    return this.settings;
  }
  ///Any applications with a backend connection running?
  anyConnectedApplications()
  {
    return $todd.applications.some(app => app.frontendid);
  }
  checkVersion()
  {
    if(this.anyConnectedApplications())
      return; //no point if apps are open

    this.tolliumservice.request('GetCurrentVersion', [], this.gotCurrentVersion.bind(this));
  }
  gotCurrentVersion(res)
  {
    if(this.anyConnectedApplications() || res.jsversion == whintegration.config.obj.jsversion)
      return;

    ///This is an updated WebHare version; use that info
    console.warn("Have to update, detected change to the JS code and no apps are running!");
    sessionStorage["WebHare-lastInitVersion-updated"] = "1";
    location.reload(true);
  }
  checkWasJustUpdated()
  {
    let wasjustupdated = sessionStorage.getItem("WebHare-lastInitVersion-updated") == "1";
    sessionStorage.removeItem("WebHare-lastInitVersion-updated");
    return wasjustupdated;
  }

  _updateFeedbackHandler(scope)
  {
    if(scope)
    {
      if(!this.feedbackhandler)
        this.feedbackhandler = new TolliumFeedbackAPI;
      this.feedbackhandler.scope = scope;
    }
    else if(!scope && this.feedbackhandler)
    {
      this.feedbackhandler.remove();
      this.feedbackhandler = null;
    }
  }

  applyShellSettings(settings)
  {
    this.settings = settings;
    this._updateFeedbackHandler(settings.feedbackscope);

    this.eventsconnection.setGroups(settings.eventgroups);
    this.broadcaststart = Date.parse(settings.now);
    this.eventsconnection.start();
    $todd.towl.setNotificationLocation(settings.notificationslocation);

    dompack.dispatchCustomEvent(window, 'tollium:settingschange', {bubbles:true, cancelable:false});
    if(document.getElementById('openinfo'))
    {
      document.getElementById('openinfo').style.display = settings.openinfo ? "block" : "none";
      document.getElementById('openinfo').textContent = settings.openinfo;
    }

    var curapp = $todd.applicationstack.slice(-1)[0];
    if (curapp)
      curapp.setAppTitle(curapp.title);

    setupWHCheck(settings.checkinterval);

    if(whconnect.hasConnect())
      whconnect.postToConnect({ method:'register', version: settings.version, servername: settings.servername });
  }
  sendApplicationMessage(app, target, message, reuse_instance, isfrontendapp, webvars, inbackground)
  {
    if($todd.IsDebugTypeEnabled('communication'))
      console.log('toddSendApplicationMessage: app:' + app + ' reuse:' + reuse_instance + ' target:' + JSON.stringify(target) + " message:" + JSON.stringify(message));

    if (typeof reuse_instance !== "string")
      reuse_instance = reuse_instance ? "always" : "never";

    //FIXME: Send actual mesage and data
    if (reuse_instance !== "never")
    {
      for (var i=0; i < $todd.applications.length;++i)
      {
        //console.log('Compare with ' + i + ' app:' + $todd.applications[i].appname + ' target:', $todd.applications[i].apptarget);

        if($todd.applications[i].appname == app && JSON.stringify($todd.applications[i].apptarget) == JSON.stringify(target))
        {
          //Found it!
          //console.log("Reuse application #" + i);

          if (reuse_instance === "always")
          {
            if (message)
              $todd.applications[i].queueEvent("$appmessage", { message: message, onlynonbusy: false }, false);
            $todd.applications[i].activateApp();
          }
          else // onlynonbusy
          {
            $todd.applications[i].queueEventAsync("$appmessage", { message: message || null, onlynonbusy: true }).then(reply =>
            {
              if (reply && reply.busy)
                this.startBackendApplication(app, null, { target: target, message: message, isfrontendapp: isfrontendapp, webvars:webvars, inbackground: inbackground });
              else
                $todd.applications[i].activateApp();
            });
          }
          return;
        }
      }
    }

    if (app == "tollium:builtin.oauth")
    {
      this.startFrontendApplication(app, null,
                              { onappbar: true
                              });
      return;
    }
    this.startBackendApplication(app, null, { target: target, message: message, isfrontendapp: isfrontendapp, webvars:webvars, inbackground: inbackground });
  }
  executeInstruction(instr)
  {
    if(instr.type=='appmessage')
    {
      //ADDME background flag is now missing with initial launches, but i think it should just be specified by caller
      this.sendApplicationMessage(instr.app, instr.target, instr.message, instr.reuse_instance, instr.isfrontendapp, instr.webvars, instr.inbackground);
      return;
    }

    if(instr.type=='windowopen')
    {
      window.open(instr.link,'_blank');
      return;
    }

    if(instr.type=='shell:reveal') //mount + open in finder
    {
      //ADDME handle directly, don't pass through shell
      whconnect.revealInFinder(instr.folder);
      return;
    }

    if (instr.type=="shell:resetimagecache")
    {
      toddImages.resetImageCache();
      return;
    }

    console.error("Unrecognized shell instruction", instr);
  }
  onBroadcastData(event)
  {
    //ADDME dedupe events, filter events launched before we started
    event.msgs.forEach(msg =>
    {
      var data = JSON.parse(msg.msg);
      $todd.DebugTypedLog("communication", "Received a broadcast", data);

      if(new Date(data.now) < this.broadcaststart)
        return;

      var event = new domevents.CustomEvent("tollium-shell:broadcast", { bubbles:true, cancelable: false, detail: data.message});
      document.documentElement.dispatchEvent(event);
    });
  }
  onBroadcast(event)
  {
    //this event fires if data is broadcasted
    switch (event.detail.type)
    {
      case "tollium:shell.refreshmenu":
      case "tollium:shell.refreshdashboard":
      {
        this.requestNewShellSettings();
        return;
      }
      case "tollium:shell.updatechecks":
      {
        this.onCheckInterval();
        return;
      }

      case "tollium:towl.event":
      {
        var notification = { id: event.detail.id
                           , description: event.detail.description
                           , timeout: event.detail.timeout || 0
                           };
        if (event.detail.icon)
          notification.icon = event.detail.icon;
        if (event.detail.title)
          notification.title = event.detail.title;
        if (event.detail.applicationmessage)
          notification.applicationmessage = event.detail.applicationmessage;

        $todd.towl.showNotification(notification);
        return;
      }
      case "tollium:towl.hideevent":
      {
        $todd.towl.hideNotification(event.detail.id);
        return;
      }
    }
  }

  _gotMetaMessage(data)
  {
    var app = $shell.getApplicationById(data.appid);
    if(!app)
    {
      console.warn("Received error message for app " +data.appid + " but cannot find it",data.errors);
      return;
    }
    app.handleMetaMessage(data);
  }

  _gotMetaClose(frontendid)
  {
    $todd.DebugTypedLog('communication', frontendid, 'connection closed');

    var openapps = false;
    $todd.applications.forEach(function(app)
    {
      // Do we have any (non-crashed) applications open? Close them now.
      if (app.frontendid === frontendid && !app.appisclosing)
      {
        app.handleMetaClose();
        openapps = true;
      }
    });

    $todd.frontendids = $todd.frontendids.filter(id => id != frontendid); //erase

    if (openapps)
    {
      var notification =
            { id: "tollium:shell.frontendclose"
            , icon: "tollium:messageboxes/warning"
            , title: getTid("tollium:shell.frontendclose")
            , description: getTid("tollium:shell.frontendclose_description")
            , timeout: 0
            , persistent: true
            };

      $todd.towl.showNotification(notification);
    }

    this.checkVersion();
  }

  onSelectStart(event)
  {
    var target = event.target.nodeType==3 ? event.target.parentNode : event.target;
    if(['INPUT','TEXTAREA'].includes(target.tagName) || (['T-TEXT'].includes(target.tagName) && target.classList.contains('selectable')) || target.closest("div.wh-rtd-editor"))
      return; //these are okay to select. MSIE needs these explicitly allowed
    $todd.DebugTypedLog('ui', "preventing selection on: ",event.target);
    event.preventDefault();
  }

  onMouseDownFallback(event)
  {
    let focusable = getClosestValidFocusTarget(event.target);
    //console.log("*** mousedown reached toplevel for target:", event.target);
    //console.log("focusable elment:", focusable);

    if(!focusable)
    {
      //console.warn("*** Preventing focus transfer");
      event.preventDefault(); //prevent the body from receiving focus.
    }
  }

  onClick(event)
  {
    if (event.defaultPrevented)
      return;

    let link = event.target.closest("a");
    if(link && (!link.target || link.target == "_self")) //under NO circumstance a hyperlink may replace the current tollium session - move it to a new window
    {
      window.open(link, '_blank');
      event.preventDefault();
    }
  }

  onContextMenuCapture(event)
  {
    if(event.ctrlKey && event.shiftKey)
      event.stopPropagation(); //ensure that if both ctrl&shift are pressed, noone will intercept the context menu
    else
      event.preventDefault(); //in all other cases, we prevent the browser menu
  }

  _gotOffline()
  {
//    console.warn("Went offline, showing notification");

    if (!this.offlinenotification)
    {
      var notification =
            { id: "tollium:shell.offline"
            , icon: this.offlinenotificationicon
            , title: getTid("tollium:shell.offline")
            , description: getTid("tollium:shell.offline_description")
            , timeout: 0
            , persistent: true
            };

      $todd.towl.showNotification(notification);
      this.offlinenotification = true;
    }
  }

  _gotOnline()
  {
//    console.warn(this.offlinenotification ? "Online again" : "Online");

    if (this.offlinenotification)
      $todd.towl.hideNotification("tollium:shell.offline");

    this.offlinenotification = false;
  }
}


$todd.handleApplicationErrors = function(app,data)
{
  if(!data.errors.length)
  {
    //It's just telling us our parent app has terminated. ADDME if we get no errors, but there are still screens open, there's still an issue!
    app.terminateApplication();
    return;
  }

  console.log("Received error message for app",app,data);
  var messages = '';
  var trace = '\nTrace:\n';

  for (var i = 0; i < data.errors.length; ++i)
  {
    if (data.errors[i].message)
    {
      messages += data.errors[i].message + "\n";
      messages += "At " + data.errors[i].filename + "(" + data.errors[i].line + "," + data.errors[i].col + ")\n";
    }
    else
    {
      if (data.errors[i].async_origin)
        trace += data.errors[i].async_origin + "\n";
      trace += data.errors[i].filename + "(" + data.errors[i].line + "," + data.errors[i].col + ") " + data.errors[i].func + "\n";
    }
  }

  app.requireComponentTypes(['panel','button','action','textarea'], reportApplicationError.bind(null,app,data,messages,trace));
};

function reportApplicationError(app,data,messages,trace)
{
  //Set up a crash handler dialog
  var buttons = [ {item:"restartbutton"},{item:"closebutton"}];
  if(data.debugtimeout>0)
    buttons = [{"item":"debugbutton"}].concat(buttons);

  var crashdialog = app.createScreen(
    { frame:       { bodynode: 'root', specials: ['closeaction','debugaction','restartaction'], allowresize:true, allowclose:true, title: getTid("tollium:shell.errors.errordialogtitle") }
    , root:        { type: 'panel', lines: [{items: [ {item:"body"} ], height:'1pr' }
                                           ,{items: [ {item:"footer"} ]}
                                           ]
                   , height:'1pr'
                   }
    , body:        { type: 'panel', lines: [{items: [{item:"errortext"}], layout:'left'}
                                           ,{items: [{item:"errorlist"}], height:'1pr' }
                                           ]
                   , height: '1pr'
                   , spacers: { top:true, bottom:true, left:true, right:true }
                   , width:'1pr'
                   }
    , errortext:   { type: 'text', value: getTid("tollium:shell.errors.encounterederror") }
    , footer:      { type: 'panel'
                   , lines: [{items: buttons,layout:'right'}]
                   , spacers: { top:true, bottom:true, left:true, right:true }
                   , isfooter: true
                   , width:'1pr'
                   }
    , closebutton: { type: 'button', title: getTid("tollium:common.actions.close"), action: 'closeaction' }
    , closeaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
    , debugbutton: { type: 'button', title: getTid("tollium:shell.errors.debug"), action: 'debugaction' }
    , debugaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }
    , restartbutton: { type: 'button', title: getTid("tollium:shell.errors.restart"), action: 'restartaction' }
    , restartaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }
    , errorlist:   { type: 'textarea', enabled: false, value: messages + trace, minwidth:"90x", minheight:"24x", width:'1pr', height:'1pr' }
    });

  var result = { closed: false };

  //app.removeAllBusyLocks();
  crashdialog.setMessageHandler("frame", "close", closeAppAfterError.bind(null, app, result, null));
  crashdialog.setMessageHandler("closeaction", "execute", (data, callback) => closeAppAfterError(app, result, callback));
  crashdialog.setMessageHandler("debugaction", "execute", debugApp.bind(null, crashdialog, app, data));
  crashdialog.setMessageHandler("restartaction", "execute", restartApp.bind(null, crashdialog, app, data));

  // Disable debug option after timeout
  if (data.debugtimeout)
  {
    setTimeout(function()
    {
      if (!result.closed)
      {
        let debugaction = crashdialog.getComponent("debugaction");
        if (debugaction)
        {
          debugaction.xml_enabled = false;
          crashdialog.actionEnabler();
        }
      }
    }, data.debugtimeout);
  }
}

function closeAppAfterError(app, result,callback)
{
  result.closed = true;
  if (callback)
    callback();
  app.terminateApplication();
}

function debugApp(crashdialog, app, data, x, ondone)
{
  crashdialog.getComponent("debugaction").xml_enabled = false;
  crashdialog.actionEnabler();

  // appid is A:<groupid>
  $shell.sendApplicationMessage('system:debugger', null, { groupid: data.appid.substr(2) }, false);
  ondone();
}
function restartApp(crashdialog, app, data, x, ondone)
{
  console.log('action restartApp');
  crashdialog.getComponent("debugaction").xml_enabled = false;
  crashdialog.getComponent("restartaction").xml_enabled = false;
  crashdialog.actionEnabler();

  app.restart().then(ondone);
}

function onWebHareConnectError(error)
{
  $todd.towl.showNotification({ id: "tollium:shell.nowebhareconnect"
                              , icon: "tollium:messageboxes/warning"
                              , title: getTid("tollium:shell.nowebhareconnect")
                              , description: getTid("tollium:shell.nowebhareconnect_description", whconnect.getConnectURL())
                              , timeout: 15000
                              , persistent: true
                              });
}

var PlaceholderApp = class
{ constructor(appinterface, callback)
  {
    this.app = appinterface;
  }
};

//The API we'll export to external applictions
window.$tollium =
{ version:1
, registerJSApp: $todd.registerJSApp
, componentsToMessages: $todd.componentsToMessages
};

whconnect.setup({ onError: onWebHareConnectError });
module.exports = IndyShell;
