/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/****************************************************************************************************************************
 *                                                                                                                          *
 *  TODD INITIALIZATION AND LOADER                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/

import { getComponents } from '@mod-tollium/webdesigns/webinterface/components';
import TolliumFeedbackAPI from '@mod-tollium/webdesigns/webinterface/js/feedback';
import TransportManager from './comm/transportmanager';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';

//We need to configure window extensions for the debuginterface
import type { } from "@mod-tollium/js/internal/debuginterface";

const todd_components = getComponents();

// for tests: this is the shortest test that's sufficient to open the Logoff window
// todd_components = { button: require("@mod-tollium/webdesigns/webinterface/components/button/button.es").default
//                   , text: require("@mod-tollium/webdesigns/webinterface/components/text/text.es").default
//                   , action: require("@mod-tollium/webdesigns/webinterface/components/action/action.es").default
//                   , panel: require("@mod-tollium/webdesigns/webinterface/components/panel/panel.es").default
//                   };


import * as dompack from 'dompack';
import * as storage from 'dompack/extra/storage';
import * as whintegration from '@mod-system/js/wh/integration';
import './debugging/magicmenu';

const EventServerConnection = require('@mod-system/js/net/eventserver');
import { setupWHCheck } from './shell/whcheck';
import { setupMouseHandling } from "./shell/mousehandling";
import { setupKeyboardHandling } from "./shell/keyboardhandling";
import { AppMgr } from './shell/appmgr';

import * as $todd from './support';
import { type ApplicationBase, BackendApplication, FrontendEmbeddedApplication, registerJSApp } from './application';
import ApplicationBar from './shell/applicationbar';
import "./apps/dashboard";
import "./apps/oauth";
import "../css/vars.scss";
require('../css/shell.css');
require('../css/apps.scss');
require('../skins/default/skin.scss');
require('../skins/default/controls.scss');

import * as toddImages from "@mod-tollium/js/icons";

import TowlNotifications from './shell/towl';

import { getTid } from "@webhare/gettid";
require("../common.lang.json");

import TolliumShell, { type AppStartResponse } from "@mod-tollium/shell/platform/shell";
import type { AppLaunchInstruction, ShellInstruction, MenuAppGroup } from '@mod-platform/js/tollium/types';
import { logout } from '@webhare/frontend';

// Prevent reloading or closing the window (activated if any of the applications is dirty)
function preventNavigation(event) {
  // For Safari and Firefox, preventDefault triggers the confirmation dialog
  event.preventDefault();
  // For Chrome, setting the returnValue to anything triggers the confirmation dialog
  event.returnValue = "";
}

let indyshellinstance: IndyShell | undefined;

class ShellSettings { //see applicationportal.whlib GetCurrentShellSettings
  lang = 'en';
  eventgroups: string[] = [];
  now: string = ''; //TODO why not a Instant ?
  apps: MenuAppGroup[] = [];
  newsitems: unknown[] = [];
  dashboard: boolean = false;
  dashboardbg: unknown | null = null; //TODO WrapCachedImage result
  displayimage: string = '';
  displayname: string = '';
  personalsettings: AppLaunchInstruction | null = null;
  userdisplayname: string = '';
  browsertitleprefix: string = '';
  openinfo: string = '';
  checkinterval: number = 0;
  issysop: boolean = false;
  notificationslocation: "none" | "browser" | "desktop" = "browser";
  feedbacktoken: string = "";
  initialinstructions: AppLaunchInstruction[] = [];
}

class IndyShell extends TolliumShell {
  settings = new ShellSettings;
  isloggingoff = false;
  istodd = false;
  eventsconnection = new EventServerConnection({ url: "/wh_events/" });
  broadcaststart: number | null = null; //start of broadcasts. used to filter old messages
  isloggedin = false;
  offlinenotification = false;

  feedbackhandler: TolliumFeedbackAPI | null = null;

  appmgr = new AppMgr(this);
  applicationbar: ApplicationBar | null = null;

  towl = new TowlNotifications(this);
  transportmgr = new TransportManager(
    {
      ononline: () => this._gotOnline(),
      onoffline: () => this._gotOffline()
    });
  placeholderapp?: ApplicationBase;

  constructor(setup) {
    super(setup);
    if (indyshellinstance)
      throw new Error(`Duplicate shell instance`);

    window.$shell = this; //FIXME shouldn't need this!
    indyshellinstance = this; //FIXME.. or this, but at least its slightly better than having to hack a global
    this.eventsconnection.on("data", event => this.onBroadcastData(event));
    dompack.onDomReady(() => void this.onDomReady());
    document.documentElement.addEventListener("tollium-shell:broadcast", evt => this.onBroadcast(evt));
    window.addEventListener("hashchange", evt => this._onHashChange(evt));

    setupMouseHandling();
    setupKeyboardHandling(this);
  }

  _onHashChange() {
    if (!location.hash.startsWith("#go="))
      return; //no support

    //Pass #go= url to the first started application (ADDME what if it's gone? this should currently only be used in combination with appbar-less applications. perhaps save the name of first forcedapp ?)
    if ($todd.applications.length >= 1)
      $todd.applications[0].queueEvent("$appmessage", { message: { go: decodeURIComponent(location.hash.substr(4).split('&')[0]) }, onlynonbusy: false }, false);

    history.replaceState({}, null, location.href.split('#')[0]);
  }

  /****************************************************************************************************************************
   * External API
   */
  registerCustomAction(name, handler) {
    if ($todd.customactions[name]) {
      console.error("A handler for custom action '" + name + "' is already installed");
      return;
    }
    $todd.customactions[name] = handler;
  }

  /****************************************************************************************************************************
   * Application management
   */

  startFrontendApplication(appname, parentapp, options) {
    const application = new FrontendEmbeddedApplication(this, appname, (options && options.target) || {}, parentapp, options);
    $todd.applications.push(application);

    application.loadApplication({
      src: options.src,
      baseobject: appname
    });
    if (!options.inbackground && !parentapp)
      this.appmgr.activate(application);

    return application;
  }
  startBackendApplication(appname, parentapp, options?) {
    if (appname === '__jsapp_hack__') //FIXME proper way to start JS frontend apps
      return this.startFrontendApplication('TestJSApp', parentapp, { src: '/tollium_todd.res/webhare_testsuite/tollium/jsapp.js' });

    this.towl.hideNotification("tollium:shell.frontendclose");

    const webvars = [], params = new URL(location.href).searchParams;
    for (const key of params.keys())
      webvars.push({ name: key, value: params.get(key) });

    options = {
      ...options,
      frontendid: whintegration.config.obj.frontendid,
      shortunknowntids: whintegration.config.obj.shortunknowntids,
      params: whintegration.config.obj.appserviceparams,
      webvars: webvars
    };

    if (!options.isloginapp && location.hash.startsWith('#go=')) {
      options.goparam = decodeURIComponent(location.hash.substr(4).split('&')[0]);
      history.replaceState({}, null, location.href.split('#')[0]);
    }

    const application = new BackendApplication(this, appname, (options && options.target) || {}, parentapp, options);
    $todd.applications.push(application);

    application.launchApp();
    if (!options.inbackground && !parentapp)
      this.appmgr.activate(application);

    return application;
  }
  editPersonalSettings() {
    if (this.settings.personalsettings)
      this.executeInstruction(this.settings.personalsettings);
  }

  checkDirtyState() {
    // If any of the applications is dirty, add the beforeunload listener, otherwise remove it
    if ($todd.applications.some(app => app.dirty)) {
      window.addEventListener("beforeunload", preventNavigation, { capture: true });
    } else {
      window.removeEventListener("beforeunload", preventNavigation, { capture: true });
    }
  }

  /****************************************************************************************************************************
   * Component registration, creation and loading API
   */

  // If callback is not defined, loading new components is not allowed
  // Returns a list of unloaded components
  checkComponentsLoaded(compnames, callback) {
    const unloaded_components = [];
    compnames.forEach(item => {
      if (!todd_components[item] && !unloaded_components.includes(item))
        unloaded_components.push(item);
    });

    if (unloaded_components.length > 0) {
      console.error("Unknown components: " + unloaded_components.join("; "));
    }
    return unloaded_components;
  }

  createComponent(type, parentcomp, data): ToddCompBase {
    return new (this.getComponentType(type))(parentcomp, data);
  }

  getComponentType(type) {
    if (todd_components[type])
      return todd_components[type];

    throw new Error(`Unrecognized component type '${type}'`);
  }

  /****************************************************************************************************************************
   * Internal functions: framework bootup
   */
  async onDomReady() {
    if (!document.body) //early termination of load, eg wrdauth redirect
      return;

    await document.fonts.ready;

    // Initialize global event handlers
    window.addEventListener("pagehide", evt => this.onUnload());

    window.addEventListener("dragover", evt => dompack.stop(evt));
    window.addEventListener("drop", evt => dompack.stop(evt));

    const appbar = document.getElementById('t-apptabs');
    if (appbar)
      this.applicationbar = new ApplicationBar(this, appbar);

    registerJSApp('tollium:builtin.placeholder', PlaceholderApp);

    // Load the offline notification icon, so it can be shown when actually offline
    this.offlinenotificationicon = toddImages.createImage("tollium:messageboxes/warning", 24, 24, 'b');

    this.executeShell();
  }

  executeShell() { //this needs to be a separate entry point for the login app
    //Launch a placeholder app, simply to get 'something' up and running fast, and display the loader (otherwise we'd have to hack a special loader for 'no-apps')
    this.startuplock = dompack.flagUIBusy();
    this.placeholderapp = this.startFrontendApplication('tollium:builtin.placeholder', null, { onappbar: false });

    console.log("launching StartPortal and the shell");

    //This is the true shell. Ask the tollium shell what we need to do. Pass it any webvariables?
    const options = {};
    options.params = whintegration.config.obj.appserviceparams;
    this.tolliumservice.startPortal([options]).then(this.gotPortal.bind(this), this.failPortal.bind(this));
  }
  gotPortal(data) {
    this.isloggedin = data.isloggedin;

    this.applyShellSettings(data.settings);
    setInterval(() => this.checkVersion(), 5 * 60 * 1000); //check for version updates etc every 5 minutes

    this.invitetype = (new URL(location.href)).searchParams.get("wrd_pwdaction");
    const runinviteapp = ["resetpassword"].includes(this.invitetype);

    if (runinviteapp || !data.isloggedin) {
      if (runinviteapp)
        this.loginapp = this.startBackendApplication("system:" + this.invitetype, null,
          {
            onappbar: false,
            //, src: '/.tollium/ui/js/login.js'
            //, target: data.loginconfig
            isloginapp: true
          });
      else
        this.loginapp = this.startFrontendApplication("tollium:builtin.login", null,
          {
            onappbar: false,
            target: data.loginconfig,
            isloginapp: true
          });

      if (this.placeholderapp) { //we can close it now
        this.placeholderapp.terminateApplication();
        this.placeholderapp = undefined;
      }
      this.startuplock.release();
      return;
    }

    if (!this.dashboardapp && data.settings.dashboard)
      this.dashboardapp = this.startFrontendApplication('tollium:builtin.dashboard', null, { src: '/.tollium/ui/js/dashboard.js', fixedonappbar: true });

    data.settings.initialinstructions.forEach(instr => this.executeInstruction(instr));

    if (this.placeholderapp) { //we can close it now
      this.placeholderapp.terminateApplication();
      this.placeholderapp = undefined;
    }

    if (this.checkWasJustUpdated()) {
      const notification = {
        id: -987654321,
        timeout: 15000, //this is just a "why did we flash". if you weren't looking, not really relevant, so go away after 15 secs
        icon: "tollium:messageboxes/information",
        title: getTid("tollium:shell.webhareupdated"),
        description: getTid("tollium:shell.webhareupdated_description")
      };

      this.towl.showNotification(notification);
    }
    this.startuplock.release();
  }
  failPortal(response) {
    console.log(response);
    this.startuplock.release();
    /* Sending an alert here may block WRD redirecting away to the login page... as a location.href=... redirect will cancel all fetches, causing them
       to throw and our alert may then block the redirect. TODO: if we had a (tollium) dialogapi we could trigger that here, as that won't block
    alert("Portal startup failed");
    */
  }
  onApplicationEnded(app) {
    if (this.isloggingoff) //do not interfere with the normal closing of apps
      return;

    if ($todd.applications.length === 0) //no dashboard and no way to open an app?
    {
      if (this.invitetype)  //reload without invite vars
        location.href = location.href.split('?')[0];
      else
        window.close();
    } else if (!this.anyConnectedApplications()) {
      this.checkVersion(); //poll for new version when all apps are closed
    }
  }

  doLogoff() {
    this.isloggingoff = true; //prevent dashboard etc from playing during a logoff

    $todd.applications.forEach(app => app.terminateApplication());
    logout();
  }
  requestNewShellSettings() {
    const options = {};
    options.params = whintegration.config.obj.appserviceparams;
    this.tolliumservice.getCurrentShellSettings(options).then(this.applyShellSettings.bind(this));
  }
  getCurrentSettings() {
    return this.settings;
  }
  ///Any applications with a backend connection running?
  anyConnectedApplications() {
    return $todd.applications.some(app => app.frontendid);
  }
  checkVersion() {
    if (this.anyConnectedApplications())
      return; //no point if apps are open

    this.tolliumservice.getCurrentVersion().then(this.gotCurrentVersion.bind(this));
  }
  gotCurrentVersion(res) {
    if (this.anyConnectedApplications() || res.jsversion === whintegration.config.obj.jsversion)
      return;

    ///This is an updated WebHare version; use that info
    console.warn("Have to update, detected change to the JS code and no apps are running!");
    storage.setSession("WebHare-lastInitVersion-updated", 1);
    location.reload();
  }
  checkWasJustUpdated() {
    const wasjustupdated = storage.getSession("WebHare-lastInitVersion-updated") === "1";
    storage.setSession("WebHare-lastInitVersion-updated", null);
    return wasjustupdated;
  }

  _updateFeedbackHandler(token: string) {
    if (token) {
      if (!this.feedbackhandler)
        this.feedbackhandler = new TolliumFeedbackAPI;
      this.feedbackhandler.token = token;
    } else if (!token && this.feedbackhandler) {
      this.feedbackhandler.remove();
      this.feedbackhandler = null;
    }
  }

  applyShellSettings(settings: ShellSettings) {
    this.settings = settings;
    this._updateFeedbackHandler(settings.feedbacktoken);

    this.eventsconnection.setGroups(settings.eventgroups);
    this.broadcaststart = Date.parse(settings.now);
    this.eventsconnection.start();
    this.towl.setNotificationLocation(settings.notificationslocation);

    dompack.dispatchCustomEvent(window, 'tollium:settingschange', { bubbles: true, cancelable: false });
    const openinfo = dompack.qS("#openinfo");
    if (openinfo) {
      openinfo.style.display = settings.openinfo ? "block" : "none";
      openinfo.textContent = settings.openinfo;
    }

    const curapp = $todd.applicationstack.at(-1);
    if (curapp)
      curapp.setAppTitle(curapp.title);

    setupWHCheck(this, settings.checkinterval);
  }
  sendApplicationMessage(app: AppLaunchInstruction["app"], target: AppLaunchInstruction["target"], message: AppLaunchInstruction["message"], reuse_instance: AppLaunchInstruction["reuse_instance"], inbackground?: boolean, appoptions?) {
    if ($todd.IsDebugTypeEnabled('communication'))
      console.log('toddSendApplicationMessage: app:' + app + ' reuse:' + reuse_instance + ' target:' + JSON.stringify(target) + " message:" + JSON.stringify(message));

    if (typeof reuse_instance !== "string")
      reuse_instance = reuse_instance ? "always" : "never";

    //FIXME: Send actual message and data
    if (reuse_instance !== "never") {
      for (let i = 0; i < $todd.applications.length; ++i) {
        //console.log('Compare with ' + i + ' app:' + $todd.applications[i].appname + ' target:', $todd.applications[i].apptarget);

        if ($todd.applications[i].appname === app && JSON.stringify($todd.applications[i].apptarget) === JSON.stringify(target)) {
          //Found it!
          //console.log("Reuse application #" + i);

          if (reuse_instance === "always") {
            if (message)
              $todd.applications[i].queueEvent("$appmessage", { message: message, onlynonbusy: false }, false);
            this.appmgr.activate($todd.applications[i]);
          } else { // onlynonbusy
            $todd.applications[i].queueEventAsync("$appmessage", { message: message || null, onlynonbusy: true }).then(reply => {
              if (reply && reply.busy)
                return this.startBackendApplication(app, null, { target: target, message: message, inbackground: inbackground, ...appoptions });

              this.appmgr.activate($todd.applications[i]);
            });
          }
          return $todd.applications[i];
        }
      }
    }

    if (app === "tollium:builtin.oauth")
      return this.startFrontendApplication(app, null, { onappbar: true, ...appoptions });

    return this.startBackendApplication(app, null, { target: target, message: message, inbackground: inbackground, ...appoptions });
  }
  executeInstruction(instr: ShellInstruction) {
    if (instr.type === 'appmessage') {
      //ADDME background flag is now missing with initial launches, but i think it should just be specified by caller
      this.sendApplicationMessage(instr.app, instr.target, instr.message, instr.reuse_instance, instr.inbackground);
      return;
    }

    if (instr.type === 'windowopen') {
      window.open(instr.link, '_blank');
      return;
    }

    if (instr.type === "shell:resetimagecache") {
      toddImages.resetImageCache();
      return;
    }

    console.error("Unrecognized shell instruction", instr);
  }
  onBroadcastData(event) {
    //ADDME dedupe events, filter events launched before we started
    event.msgs.forEach(msg => {
      const data = JSON.parse(msg.msg);
      $todd.DebugTypedLog("communication", "Received a broadcast", data);

      if (new Date(data.now) < this.broadcaststart)
        return;

      dompack.dispatchCustomEvent(document.documentElement, "tollium-shell:broadcast", { bubbles: true, cancelable: false, detail: data.message });
    });
  }
  onBroadcast(event) {
    //this event fires if data is broadcasted
    switch (event.detail.type) {
      case "tollium:shell.refreshmenu":
      case "tollium:shell.refreshdashboard":
        {
          this.requestNewShellSettings();
          return;
        }

      case "tollium:towl.event":
        {
          const notification = {
            id: event.detail.id,
            description: event.detail.description,
            timeout: event.detail.timeout || 0
          };
          if (event.detail.icon)
            notification.icon = event.detail.icon;
          if (event.detail.title)
            notification.title = event.detail.title;
          if (event.detail.applicationmessage)
            notification.applicationmessage = event.detail.applicationmessage;

          this.towl.showNotification(notification);
          return;
        }
      case "tollium:towl.hideevent":
        {
          this.towl.hideNotification(event.detail.id);
          return;
        }
    }
  }

  _gotMetaMessage(data) {
    const app = this.getApplicationById(data.appid);
    if (!app) {
      console.warn("Received error message for app " + data.appid + " but cannot find it", data.errors);
      return;
    }
    app.handleMetaMessage(data);
  }

  onFrontendClose() {
  }

  gotMetaClose(linkid: string, openapps: boolean) {
    super.gotMetaClose(linkid, openapps);
    if (openapps) {
      const notification = {
        id: "tollium:shell.frontendclose",
        icon: "tollium:messageboxes/warning",
        title: getTid("tollium:shell.frontendclose"),
        description: getTid("tollium:shell.frontendclose_description"),
        timeout: 0,
        persistent: true
      };

      this.towl.showNotification(notification);
    }
    this.checkVersion();
  }

  _gotOffline() {
    //    console.warn("Went offline, showing notification");

    if (!this.offlinenotification) {
      const notification = {
        id: "tollium:shell.offline",
        icon: this.offlinenotificationicon,
        title: getTid("tollium:shell.offline"),
        description: getTid("tollium:shell.offline_description"),
        timeout: 0,
        persistent: true
      };

      this.towl.showNotification(notification);
      this.offlinenotification = true;
    }
  }

  _gotOnline() {
    //    console.warn(this.offlinenotification ? "Online again" : "Online");

    if (this.offlinenotification)
      this.towl.hideNotification("tollium:shell.offline");

    this.offlinenotification = false;
  }

  onUnload() {
    // prepare transportmgr for unload
    this.transportmgr.prepareForUnload();

    // Let every app send their shutdown message
    $todd.applicationstack.forEach(function (app) { app.queueUnloadMessage(); });
    this.transportmgr.executeUnload();

    this.transportmgr.destroy();
  }
}


export async function handleApplicationErrors(app: ApplicationBase, data: AppStartResponse) {
  const $shell = getIndyShell();
  if ("error" in data && data.error) { //An error code from StartApp
    switch (data.error) {
      case "notloggedin": {
        await runSimpleScreen(app, { text: getTid("tollium:shell.login.notloggedin"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
        if (!$shell.anyConnectedApplications()) //looks safe to restart ? as long as we don't have JSApps other than dashboard I guess
          $shell.doLogoff();
        return;
      }
      case "unexpectedprotocolversion": {
        await runSimpleScreen(app, { text: getTid("tollium:shell.login.unexpectedprotocolversion"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
        if (!$shell.anyConnectedApplications()) //looks safe to restart ? as long as we don't have JSApps other than dashboard I guess
          location.reload();
        return;
      }
      default: {
        // TODO unexpectedprotocolversion is being updated to transmit an errormessage.. once rolled out sufficiently we can rely on that and remove the case above
        await runSimpleScreen(app, { text: data.errormessage || data.error, buttons: [{ name: 'ok', title: getTid("~ok") }] });
        if (!$shell.anyConnectedApplications()) //looks safe to restart ? as long as we don't have JSApps other than dashboard I guess
          location.reload();
        return;
      }
    }
  }

  if ("type" in data && data.type === "expired") { //StartApp error
    await runSimpleScreen(app, { text: getTid("tollium:shell.controller.sessionexpired"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
    app.__startAppClose();
    location.reload();
    return;
  }

  if (!("errors" in data) || !data.errors?.length) {
    //It's just telling us our parent app has terminated. ADDME if we get no errors, but there are still screens open, there's still an issue!
    app.terminateApplication();
    return;
  }

  console.log("Received error message for app", app, data);
  let messages = '';
  let trace = '\nTrace:\n';

  for (let i = 0; i < data.errors.length; ++i) {
    if (data.errors[i].message) {
      messages += data.errors[i].message + "\n";
      messages += "At " + data.errors[i].filename + "(" + data.errors[i].line + "," + data.errors[i].col + ")\n";
    } else {
      trace += data.errors[i].filename + "(" + data.errors[i].line + "," + data.errors[i].col + ") " + data.errors[i].func + "\n";
    }
  }

  app.requireComponentTypes(['panel', 'button', 'action', 'textarea'], reportApplicationError.bind(null, app, data, messages, trace));
}

//TODO souldn't this be *inside* the app objects instead of the shell ? these crashes dont' exist without Apps
function reportApplicationError(app, data: AppStartResponse, messages, trace) {
  //Set up a crash handler dialog
  let buttons = [{ item: "restartbutton" }, { item: "closebutton" }];
  if (data.debugtimeout > 0)
    buttons = [{ "item": "debugbutton" }].concat(buttons);

  const crashdialog = app.createScreen(
    {
      frame: { bodynode: 'root', specials: ['closeaction', 'debugaction', 'restartaction'], allowresize: true, allowclose: true, title: getTid("tollium:shell.errors.errordialogtitle") },
      root: {
        type: 'panel', lines: [
          { layout: "block", items: [{ item: "body" }], height: '1pr' },
          { layout: "block", items: [{ item: "footer" }] }
        ],
        height: '1pr'
      },
      body: {
        type: 'panel', lines: [
          { items: [{ item: "errortext" }], layout: 'left' },
          { items: [{ item: "errorlist" }], height: '1pr' }
        ],
        height: '1pr',
        spacers: { top: true, bottom: true, left: true, right: true },
        width: '1pr'
      },
      errortext: { type: 'text', value: getTid("tollium:shell.errors.encounterederror") },
      footer: {
        type: 'panel',
        lines: [{ items: buttons, layout: 'right' }],
        spacers: { top: true, bottom: true, left: true, right: true },
        isfooter: true,
        width: '1pr'
      },
      closebutton: { type: 'button', title: getTid("~close"), action: 'closeaction' },
      closeaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      debugbutton: { type: 'button', title: getTid("tollium:shell.errors.debug"), action: 'debugaction' },
      debugaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] },
      restartbutton: { type: 'button', title: getTid("tollium:shell.errors.restart"), action: 'restartaction' },
      restartaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] },
      errorlist: { type: 'textarea', enabled: false, value: messages + trace, minwidth: "90x", minheight: "24x", width: '1pr', height: '1pr' }
    });

  const result = { closed: false };

  //app.removeAllBusyLocks();
  crashdialog.setMessageHandler("frame", "close", closeAppAfterError.bind(null, app, result, null));
  crashdialog.setMessageHandler("closeaction", "execute", (data, callback) => closeAppAfterError(app, result, callback));
  crashdialog.setMessageHandler("debugaction", "execute", debugApp.bind(null, crashdialog, app, data));
  crashdialog.setMessageHandler("restartaction", "execute", () => app.restartApp());

  // Disable debug option after timeout
  if (data.debugtimeout) {
    setTimeout(function () {
      if (!result.closed) {
        const debugaction = crashdialog.getComponent("debugaction");
        if (debugaction) {
          debugaction.xml_enabled = false;
          crashdialog.actionEnabler();
        }
      }
    }, data.debugtimeout);
  }
}

function closeAppAfterError(app, result, callback) {
  result.closed = true;
  if (callback)
    callback();
  app.terminateApplication();
}

function debugApp(crashdialog, app, data, x, ondone) {
  crashdialog.getComponent("debugaction").xml_enabled = false;
  crashdialog.actionEnabler();

  // appid is A:<groupid>
  getIndyShell().sendApplicationMessage('system:debugger', null, { groupid: data.appid.substr(2) });
  ondone();
}

var PlaceholderApp = class {
  constructor(appinterface, callback) {
    this.app = appinterface;
  }
};

//The API we'll export to external applications and debuggers
window.$tollium = {
  registerJSApp: registerJSApp,
  componentsToMessages: $todd.componentsToMessages,
  getActiveApplication: $todd.getActiveApplication
};

export function getIndyShell() {
  if (!indyshellinstance)
    throw new Error(`IndyShell not yet initialized. Ordering issue?`);
  return indyshellinstance;
}

export default IndyShell;
export type { IndyShell };
