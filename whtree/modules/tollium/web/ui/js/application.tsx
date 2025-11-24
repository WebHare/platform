/* eslint-disable */
// @ts-nocheck -- needs porting!

import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

import * as $todd from "@mod-tollium/web/ui/js/support";
import { getTid } from "@webhare/gettid";
import { loadScript } from '@webhare/dompack';
import * as utilerror from '@mod-system/js/wh/errorreporting';
import * as whintegration from '@mod-system/js/wh/integration';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import LinkEndPoint from './comm/linkendpoint';
import DocPanel from "./application/docpanel";
import "./application/appcanvas.scss";
import * as toddImages from "@mod-tollium/js/icons";
import type DirtyListener from '@mod-tollium/webdesigns/webinterface/components/frame/dirtylistener';
import type IndyShell from './shell';
import { getIndyShell, handleApplicationErrors } from './shell';
import { getFocusableComponents } from 'dompack/browserfix/focus';
import { debugFlags } from "@webhare/env";
import type { AppStartResponse } from '@mod-tollium/shell/platform/shell';

require("../common.lang.json");

const ToddProtocolVersion = 1;
const busyinitialwait = 200;  //time before we show a loader
const busydonedelay = 50;     //time before we start the 'done' fadeout

/****************************************************************************************************************************
 *                                                                                                                          *
 *  APPLICATION                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/

type JSAppConstructor = new (app: FrontendEmbeddedApplication, callback: () => void) => void;
const jsappconstructors: Record<string, JSAppConstructor> = {};
let appesqnr = 1; //to generate simple local IDs

//ADDME: Move these to SessionManager? A SessionManager would manage one user's session in a browser; the CommHandler
//       would manage one or more SessionManagers.

type ApplicationOptions = {
  container?: HTMLElement | null;
}

export class ApplicationBase {
  // ---------------------------------------------------------------------------
  //
  // Initialization
  //
  apptarget;

  /* the screenstack contains the screens currently displayed by this application (including foreign screens) in displayorder.
    screenstack.at(-1) is the currently active and only enabled screen */
  screenstack: ObjFrame[] = [];

  dirtylisteners = new Array<DirtyListener>;

  /** Application name */
  appname: string;
  /** Parent application */
  parentapp: ApplicationBase | null = null;
  /** The shell starting us */
  shell: IndyShell; //(as if there would be more than one in a JS instace?)

  screenmap: Record<string, ObjFrame> = {};

  appnodes: {
    loader: HTMLElement;
    appmodalitylayer: HTMLElement;
    docpanel: HTMLElement;
    screens: HTMLElement;
    root: HTMLElement;
  };

  /** This application is 'busy' if no screen is active. (Dashboard is an exception) */
  requiresScreen = true;
  /** If set, keep this app at the bottom of the application stack */
  onappstackbottom = false;

  //Application title
  title = getTid("tollium:shell.loadingapp");

  /// Application id
  whsid = '';


  /// Application language
  lang = 'en';

  //Is the app closing?
  protected appIsClosing = false;

  //Is the app currently showing a lock (or in the pre-spinner phase, but intending to show a spinner)
  private appShowsLocked = false;

  private appbusytimeout: NodeJS.Timeout | null = null;
  private appunbusytimeout: NodeJS.Timeout | null = null;

  private visible = false;

  ///Unique identifier for this browser load
  readonly localId;

  container: HTMLElement | null = null;

  appicon = '';

  constructor(shell: IndyShell, appname: string, apptarget, parentapp: ApplicationBase | null, options?: ApplicationOptions) {
    this.localId = "app#" + appesqnr++;
    /// Name of  app
    this.appname = appname;
    /// Target
    this.apptarget = {};

    this.shell = shell;
    this.tabmodifier = '';

    /// User config
    /// @{

    this.dateformat = '';
    this.timeformat = '';

    ///@}

    /* the screenmap contains the screens owned by this application (never includes foreign windows) */
    this.screenmap = {};

    ///@}

    this.appisbusy = false;
    this.screencounter = 0;
    this.hasissues = false;
    this.isdebugged = false;
    this.isdebugpaused = false;
    this.appmenu = [];

    this._apploaddeferred = Promise.withResolvers();
    this._apploadlock = dompack.flagUIBusy();

    if (options) {
      this.container = options.container;
      options.container = null;
    }

    if (!this.container)
      this.container = dompack.qS('#desktop');

    this.options = {
      onappbar: true,
      fixedonappbar: false,
      ...options
    };

    this.apptarget = apptarget;
    this.appnodes = {};

    this.appnodes.loader = <div class="appcanvas__loader" />;
    this.appnodes.appmodalitylayer = <div class="appcanvas__appmodalitylayer">{this.appnodes.loader}</div>;
    this.appnodes.docpanel = <div class="appcanvas__docpanel" />;
    this.appnodes.screens = <div class="appcanvas__screens">{this.appnodes.appmodalitylayer}</div>;
    this.appnodes.root = <div class="appcanvas" lang={this.lang}>{this.appnodes.screens}{this.appnodes.docpanel}</div>;

    this.container.appendChild(this.appnodes.root);

    if (parentapp) {
      this.parentapp = parentapp;
      this.options.onappbar = false;
    }

    this.setOnAppBar(this.options.onappbar, this.options.fixedonappbar);

    if (!parentapp)
      this.setVisible(true);

    if ($todd.IsDebugTypeEnabled('ui')) // Show busy locks when clicking on modality layer
      this.appnodes.appmodalitylayer.addEventListener('click', evt => this.showBusyFlags(evt));
  }

  getLoadPromise() {
    return this._apploaddeferred.promise;
  }

  _resolveAppLoad() {
    this._apploaddeferred.resolve();
    if (this._apploadlock)
      this._apploadlock.release();
    this._apploadlock = null;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff: busy indication
  //

  getAppCanvas() {
    return this.appnodes.screens;
  }

  showBusyFlags() {
    console.log('Current busy locks:');
    window.$dompack$busylockmanager.logLocks();
  }

  displayBusy() {
    this.appnodes.root.classList.add("appcanvas--isbusyindicator");
    this.appbusytimeout = null;
  }

  undisplayBusy() {
    this.appnodes.root.classList.remove("appcanvas--isbusyindicator");
    this.appnodes.root.classList.remove("appcanvas--isbusydone");
    this.appunbusytimeout = null;
  }

  // ---------------------------------------------------------------------------
  //
  // Embedded application API: Base application functions
  //

  isBusy() {
    return this.appnodes.root.classList.contains('appcanvas--isbusy');
  }

  getTopScreen(): ObjFrame | null {
    return this.screenstack.at(-1) || null;
  }

  /// Load the requested component types, invoke 'callback' when they are loaded
  requireComponentTypes(requiredtypes, callback) {
    const unloaded_components = this.shell.checkComponentsLoaded(requiredtypes, callback);
    if (unloaded_components.length)
      return;
    callback();
  }

  promiseComponentTypes(requiredtypes) {
    return new Promise(function (resolve, reject) {
      this.requireComponentTypes(requiredtypes, resolve);
    }.bind(this));
  }

  /// request a graceful close
  requestClose() {
    if (this.screenstack.length !== 1) //modal dialog open
      return;
    this.getTopScreen().requestClose();
  }

  // ---------------------------------------------------------------------------
  //
  // Embedded application API: Application state management
  //

  setVisible(newvisible: boolean) {
    if (this.visible === newvisible)
      return;

    this.visible = newvisible;

    if (!this.visible) {
      if (this === $todd.applicationstack.at(-1)) //we're the currently selected app
      {
        if ($todd.applicationstack.length >= 2)
          this.shell.appmgr.activate($todd.applicationstack[$todd.applicationstack.length - 2]);
      }

      const apppos = $todd.applicationstack.indexOf(this);
      if (apppos >= 0)
        $todd.applicationstack.splice(apppos, 1);

      this.shell.appmgr.onApplicationStackChange();
    }
  }
  setOnAppBar(onappbar: boolean, fixedonappbar?: boolean) {
    if (this.shell.applicationbar)
      this.shell.applicationbar.toggleShortcut(this, onappbar, fixedonappbar);
  }

  updateApplicationProperties(props) {
    this.appicon = props.appicon;
    this.appiconwidth = props.appiconwidth || 16;
    this.appiconheight = props.appiconheight || 16;
    this.tabmodifier = props.tabmodifier || '';
    if ("background" in props)
      this.appnodes.root.style.background = props.background ? props.background.css : "";

    this.setAppTitle(props.title);
    this._fireUpdateAppEvent();
  }
  _fireUpdateAppEvent() {
    dompack.dispatchCustomEvent(this.appnodes.root, "tollium:updateapp", { bubbles: true, cancelable: true });
  }
  createScreen(messages) {
    //create a new screen
    const name = 'localwin' + (++this.screencounter);
    return this.createNewScreenObject(name, 'frame', $todd.componentsToMessages(messages));
  }

  //////////////////////////////////////////////////////////////////////////////
  //
  // Dirt tracking
  // The application is dirty if any of its dirty listeners is dirty
  get dirty() {
    return this.dirtylisteners.some(listener => listener.dirty);
  }

  registerDirtyListener(listener: DirtyListener) {
    const idx = this.dirtylisteners.indexOf(listener);
    if (idx < 0) {
      this.dirtylisteners.push(listener);
      this.checkDirtyState();
    }
  }

  unregisterDirtyListener(listener: DirtyListener) {
    const idx = this.dirtylisteners.indexOf(listener);
    if (idx >= 0) {
      this.dirtylisteners.splice(idx, 1);
      this.checkDirtyState();
    }
  }

  checkDirtyState() {
    // Update the dirty indicator on the app tab and app tabs bar overflow menu
    this._fireUpdateAppEvent();
    // Add or remove the beforeunload listener
    this.shell.checkDirtyState();
  }



  // ---------------------------------------------------------------------------
  //
  // Application state
  //
  isActiveApplication() {
    return this === $todd.applicationstack.at(-1);
  }

  setAppcanvasVisible(show: boolean) {
    //named setAppcanvasVisible as setVisible is more about the app lifecycle and not tab switching
    this.appnodes.root.inert = !show;
    this.appnodes.root.hidden = !show;
    this.appnodes.root.classList.toggle('appcanvas--visible', show);

    if (show) {
      this.setAppTitle(this.title); //reapply same value to update document.title where needed

      //restore focus
      const topScreen = this.getTopScreen();

      if (debugFlags["tollium-focus"])
        console.log("[tollium-focus] App focus to '%s', now focus %o", this.title, this.getTopScreen() ?? this.appnodes.root);

      if (topScreen)
        topScreen.updateFocusable();
      else //no screens, but may just be a dashboard
        getFocusableComponents(this.appnodes.root)[0]?.focus();
    }
  }

  __startAppClose() { //should be private but shell needs it
    return; //disabled for now. we don't seem to need it? enabling it causes tollium.comm.testappstart to hang on Exception screen. TODO: or was this triggered by shell.ts referring to it in lowercase, ie 'appisclosing' ?
    this.appIsClosing = true;
    this.notifyTopScreenChange();
  }

  isLocked(): boolean {
    return this.appShowsLocked;
  }

  private getAppAndChildren(): ApplicationBase[] {
    const apps: ApplicationBase[] = [];
    let app: ApplicationBase = this;
    while (app.parentapp)
      app = app.parentapp;

    for (; ;) {
      apps.push(app);
      const child = $todd.applications.find(_ => _.parentapp === app);
      if (child) {
        app = child;
        continue; //keep searching down
      }
      return apps;
    }
  }

  private getAppGlobalTopScreen(): ObjFrame | null {
    const apps = this.getAppAndChildren();
    for (let idx = apps.length - 1; idx >= 0; --idx)
      if (apps[idx].getTopScreen())
        return apps[idx].getTopScreen();
    return null;
  }


  notifyTopScreenChange(): void {
    //Apps can be embedded into each other (only used by test_jsapp) so the actual topscreen might not be ours
    //If the toplevel screen is inactive and we requireScreen, or the app is closing, the app should be showing modality and busy layers
    //TODO we can do this cleaner? a parent can only have one child so we might be able to link more directly. or separate the 'column of apps/screens' inside a tab from their actual backends
    const globaltop = this.getAppGlobalTopScreen();
    const shouldBeLocked = (globaltop ? (!globaltop?.active || globaltop?.isLocked()) : this.requiresScreen) || this.appIsClosing;
    if (debugFlags["tollium-active"])
      console.log(`[${this.localId}] notifyTopScreenChange`, globaltop, "active=", globaltop?.active, "isLocked=", globaltop?.isLocked(), "appIsClosing=", this.appIsClosing, "shouldBeLocked=", shouldBeLocked, "appShowsLocked=", this.appShowsLocked);
    if (this.appShowsLocked === shouldBeLocked)
      return;  //no change

    if (shouldBeLocked) { // Apply the modality layer
      this.appnodes.root.classList.add('appcanvas--isbusy'); //initially this just applies a modality layer
      globaltop?.updateFocusable();

      // FIXME: calculate from real animation periods
      const animation_period_lcm = 6000;

      // Emulate that the animation is running continuously
      this.appnodes.loader.style.animationDelay = -(Date.now() % animation_period_lcm) + "ms";

      // Still showing busy indicators? Hide them immediately.
      if (this.appunbusytimeout) {
        clearTimeout(this.appunbusytimeout);
        this.undisplayBusy();
      }

      this.appbusytimeout = setTimeout(() => this.displayBusy(), busyinitialwait);
    } else { //remove the modality later
      // Are we still waiting for the busy indicator to show (short wait period)
      if (this.appbusytimeout) {
        // Indicator hasn't been shown yet, nothing to do
        clearTimeout(this.appbusytimeout);
        this.appbusytimeout = null;
      } else {
        // Indicator is being shown at the moment. Show done indicator
        this.appnodes.root.classList.add('appcanvas--isbusydone');

        // Remove everything after a small delay
        this.appunbusytimeout = setTimeout(() => this.undisplayBusy(), busydonedelay);
      }

      // Remove the modality layer immediately
      this.appnodes.root.classList.remove('appcanvas--isbusy');
      globaltop?.updateFocusable();
    }

    this.appShowsLocked = shouldBeLocked;
    this.shell.appmgr.notifyApplicationLockChange();
  }

  /** Handle a fatal error */
  async terminateWithFatalError(error: string) {
    await runSimpleScreen(this,
      {
        //FIXME translate
        text: `A fatal error occurred. The application will now close.\n\n${error}`,
        buttons: [
          {
            name: 'close',
            title: getTid("~close")
          }
        ],
        wordWrap: true
      });
    this.terminateApplication();
  }

  /** Terminate an application, clearing all its screens (ADDME: what if we're hosting foreign screens?)
   *
  */
  async terminateApplication(): Promise<void> {
    this.setOnAppBar(false); //first leave the appbar, so 'reopen last app' in setVisible doesn't target us
    this.setVisible(false); //also removes us from $todd.applications and informs the shell

    const apppos = $todd.applications.indexOf(this);
    if (apppos >= 0)
      $todd.applications.splice(apppos, 1);

    if (this.appcomm) // Send a termination for the app. this flushes the contentsof any screens (ie dirty RTDs) to the server
      await this.queueEventAsync('$terminate', '');

    while (this.screenstack.length) //terminate screens, toplevel first
      this.getTopScreen()!.terminateScreen();

    if (this.appcomm) {
      // Close busy locks for sync messages - FIXME dangerous, calls should be rejectable promises and that should clear the locks
      this.eventcallbacks.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
      this.eventcallbacks = [];
      this.queuedEvents = [];

      if (this.appcomm)
        this.appcomm.close();
      this.appcomm = null;
      this.whsid = '';
    }

    this.__startAppClose();

    //FIXME dispose comm channels etc?
    if (this.appnodes) {
      this.appnodes.root.remove();
      this.appnodes.appmodalitylayer.remove();
    }
    this._resolveAppLoad();
    this.shell.onApplicationEnded(this);
  }

  getToplevelApp(): ApplicationBase {
    return this.parentapp?.getToplevelApp() || this;
  }

  createNewScreenObject(windowname, framename, messages) {
    const screen = new ObjFrame(this, {
      window: windowname,
      target: framename,
      specials: []
    }, null);
    this.screenmap[windowname] = screen;
    if (messages)
      screen.processMessages(messages);

    const showapp = this.getToplevelApp();
    showapp.appnodes.screens.appendChild(screen.getNode());
    screen.showScreen(showapp);
    this.notifyTopScreenChange();

    return screen;
  }

  // ---------------------------------------------------------------------------
  //
  // Application settings
  //

  setAppTitle(newtitle) {
    this.title = newtitle;
    if ($todd.getActiveApplication() === this) {
      const prefix = this.shell.getCurrentSettings().browsertitleprefix;
      document.title = (prefix ? prefix + ' ' : '') + this.title;
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Application menu
  //

  generateAppMenu() {
    return this.appmenu.slice(0);
  }

  executeCommand(cmd) {
    if (cmd.type === 'currentapp:restart') {
      this.restartApp();
      return;
    }
    //unknown, pass it to the shell
    this.shell.executeInstruction(cmd);
  }

  // ---------------------------------------------------------------------------
  //
  // Screen management
  //

  getScreenByName(windowname) {
    return this.screenmap[windowname];
  }

  // ---------------------------------------------------------------------------
  //
  // Message processors
  //

  _onMsgGetNotificationPermissionState() {
    // This function is called in a context the state may change, so let towl check too
    getIndyShell().towl.updateForCurrentNotificationPermission();

    return window.Notification
      ? Notification.permission
      : "";
  }

  _onMsgOpenDocumentation(url, edittoken) {
    if (!this.docpanel)
      this.docpanel = new DocPanel(this, this.appnodes.docpanel);
    this.docpanel.load(url, edittoken);
  }

  _onMsgClearIconCache() {
    toddImages.resetImageCache();
    return true;
  }

  _onMsgCloseWindow() {
    window.close();
  }

  _onMsgRestartApp(options) {
    this.restartApp(options);
  }

  queueEventAsync(actionname, param) {
    return new Promise((resolve, reject) => {
      this.queueEvent(actionname, param, true, reply => resolve(reply));
    });
  }

  // ---------------------------------------------------------------------------
  //
  // Dialogs
  //

  /** Creates a dialog informing the user an exception took place, and reports the exception to the backend.
      @long This function can be used to place in a promise catch handler. It opens a messagebox informing
         the user an error took place, and reports that error to the backend. It is bound to the application,
         no rebinding necessary.
      @param e Exception object
      @example
      (*operation returning a promise*).catch(app.showExceptionDialog)
  */
  showExceptionDialog(e: Error) {
    utilerror.reportException(e);
    runSimpleScreen(this,
      {
        text: getTid("tollium:shell.errors.errortitle"),
        buttons: [{ name: 'close', title: getTid("~close") }]
      });
  }

  /// restart the application (optionally updating the target and/or sending a message)
  restartApp({ target, message } = {}) {
    if (target === undefined)
      target = this.apptarget;

    const newapp = this.shell.sendApplicationMessage(this.appname, target, message, false, true, { onappbar: false });
    this.shell.applicationbar.replaceAppWith(this, newapp);
    this.terminateApplication();
  }
}


//An embedded application 'lives' in the tollium javascript. We better trust it...
const loadedscripts: Record<string, Promise<HTMLScriptElement>> = {};
export class FrontendEmbeddedApplication extends ApplicationBase {
  baseobject: string = '';
  /** @deprecated needed by triggerWebHareSSO. nothing else? TODO if so, consider removal if FedCM or something else offers a replacement */
  app: unknown;

  constructor(shell, appname, apptarget, parentapp, options) {
    super(shell, appname, apptarget, parentapp, options);
  }

  async loadApplication(manifest: {
    baseobject: string;
    src?: string;
  }) {

    this.baseobject = manifest.baseobject;
    if (!jsappconstructors[this.baseobject]) {
      let scr = loadedscripts[manifest.baseobject];
      if (!scr) {
        scr = loadScript(manifest.src + "?__cd=" + Date.now());
        loadedscripts[manifest.baseobject] = scr;
      }
      await scr;
    }

    if (!jsappconstructors[this.baseobject]) {
      console.error("Failed to load application " + this.baseobject); //FIXME how to deal with it?
      return;
    }

    await new Promise<void>(resolve => {
      this.app = new jsappconstructors[this.baseobject](this, resolve);
    });
    this._resolveAppLoad();
  }
  queueEvent(actionname: string, param: unknown) {
    console.warn("Cannot handle event '" + actionname + "'", param);
  }

  queueUnloadMessage() {
    // No action needed in frontend apps
  }
}

export class BackendApplication extends ApplicationBase {
  // ---------------------------------------------------------------------------
  //
  // Variables
  //

  /// Application metadata and communication


  constructor(shell, appname, apptarget, parentapp, options) {
    super(shell, appname, apptarget, parentapp, options);

    /// Frontend id used for this application
    this.frontendid = '';

    /// Communication endpoint
    this.appcomm = null;

    this.lastinitmessage = 0;

    this.startoptions = {};
    //seqnr (sorted) callback
    this.eventcallbacks = [];

    this.deferred_close = null;
    this.deferred_metamessage = null;

    this.queuedEvents = [];

  }

  applyAppInit(node) {
    this.whsid = node.whsid;
    this.lang = node.lang;
    this.dateformat = node.dateformat;
    this.timeformat = node.timeformat;

    // Remove event callbacks and queued events, won't be activated again
    this.eventcallbacks.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
    this.eventcallbacks = [];
    this.queuedEvents.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
    this.queuedEvents = [];

    this.appcomm = new LinkEndPoint({ linkid: this.whsid, commhost: location.origin, frontendid: this.frontendid });
    this.appcomm.onmessage = this.processMessage.bind(this);
    this.appcomm.onclosed = this._gotLinkClosed.bind(this);
    this.appcomm.registerManuallyReceivedMessage(this.lastinitmessage);

    this.appcomm.register(this.shell.transportmgr);

    // Wait for both link close & metamessage to close application
    this.deferred_close = Promise.withResolvers();
    this.deferred_metamessage = Promise.withResolvers();

    this.deferred_close.promise
      .then(function () { return this.deferred_metamessage.promise; }.bind(this)) // wait for metamessage and adopt the value
      .then(this._closeApplication.bind(this));
  }

  handleMetaMessage(data) {
    switch (data.type) {
      case "error":
      case "expired":
        {
          this.deferred_metamessage.resolve(data);
          setTimeout(this.deferred_close.resolve, 5000); // wait max 5 secs for link close

          this.__startAppClose();
        } break;

      case "debugstatus":
        {
          this.isdebugged = data.attached;
          this.isdebugpaused = data.paused;
          this._fireUpdateAppEvent();
        } break;
    }
  }

  handleMetaClose(): boolean {
    if (this.appIsClosing)
      return false;
    this.deferred_metamessage.resolve(null);
    setTimeout(this.deferred_close.resolve, 5000); // wait max 5 secs for link close
    return true; //we had something to close!
  }

  start(frontendid) {
    this.frontendid = frontendid;
  }

  generateAppMenu() {
    return [
      {
        title: getTid('tollium:shell.restartapp'),
        cmd: { type: "currentapp:restart" }
      },
      ...super.generateAppMenu()
    ];
  }

  /****************************************************************************************************************************
   * Communications
   */

  queueEvent(actionname: string, param: unknown, synchronous: boolean, originalcallback?: () => void) { //for legacy queueEvent calls, too many still remaining
    //TODO the screens invoking us should be locking us, instead of us assuming topscreen
    const busylock = synchronous && this.getTopScreen() ? this.getTopScreen()!.lockScreen() : dompack.flagUIBusy();
    const finalcallback = () => { busylock.release(); if (originalcallback) originalcallback(); };
    this.queueEventNoLock(actionname, param, synchronous, finalcallback);
  }

  queueEventNoLock(actionname: string, param: unknown, synchronous?: boolean, callback?: () => void, skipStateTransfer?: boolean) {
    if (!this.appcomm)
      console.error("Trying to send event after the application link closed: ", actionname, param);

    this.queuedEvents.push(
      {
        actionname: actionname,
        param: param,
        synchronous: synchronous,
        callback: callback,
        skipStateTransfer
      });

    this._sendQueuedEvents();
  }

  _sendQueuedEvents() {
    if (!this.appcomm) // Not shut down already?
      return;

    let sentforms = false;
    while (this.queuedEvents.length) {
      if (this.eventcallbacks.some(_ => _.synchronous))
        return; // wait for earlier sync events to finish

      const seqnr = this.appcomm.allocMessageNr(); //we need a seqnr early to be able to lock the synchronous message queue
      const event = this.queuedEvents.shift();
      this.eventcallbacks.push({ seqnr: seqnr, callback: event.callback, synchronous: event.synchronous });

      const forms = [];
      // Send forms only once per run of events
      if (!sentforms && !event.skipStateTransfer) {
        for (const key of Object.keys(this.screenmap))
          forms.push({
            name: key,
            fields: this.screenmap[key].getSubmitVariables()
          });

        sentforms = true;
      }

      var response = {
        action: event.actionname,
        param: event.param || '',
        forms,
        requirereply: true
      };

      if ($todd.IsDebugTypeEnabled('rpc')) {
        console.group("RPC log - outgoing. " + (response.requirereply ? 'sync' : 'async') + ", action: " + (event.actionname || 'n/a') + ', param:', event.param || '');
        for (var i = 0; i < response.forms.length; ++i) {
          console.group("form " + response.forms[i].name);
          Object.keys(response.forms[i].fields, key => console.log('comp ' + key + ' value: ', response.forms[i].fields[key]));
          console.groupEnd();
        }
        console.groupEnd();
      }

      this.appcomm.queueMessageWithSeqnr(seqnr, response);
    }
  }

  applyReceivedReplies(replies) {
    // Execute callbacks for the events, and remove them from the callbacks array
    replies.forEach(reply => {
      $todd.DebugTypedLog("messages", 'got reply for ', reply.seqnr);
      const pos = this.eventcallbacks.findIndex(callback => callback.seqnr === reply.seqnr);
      if (pos >= 0) {
        const rec = this.eventcallbacks.splice(pos, 1)[0];
        if (rec.callback)
          rec.callback(reply.replydata);
      }
    });

    this._sendQueuedEvents();
  }

  handleMessage(msgrec) {
    switch (msgrec.type) {
      case 'response':
        {
          this.processMessage(msgrec.response);
        } break;
      default:
        {
          console.error('Unrecognized message type ', msgrec.type, msgrec);
        }
    }
  }

  getRequiredComponentTypes(msg) {
    const types = [];
    msg.screens.forEach(screen =>
      screen.messages.forEach(screenmsg => {
        if (screenmsg.instr === 'component' && !types.includes(screenmsg.type))
          types.push(screenmsg.type);
      }));
    return types;
  }

  processMessage(msg) {
    if ($todd.IsDebugTypeEnabled('rpc')) {
      console.group("RPC log - incoming");
      console.log(msg);
      msg.instructions.forEach(function (instr) {
        console.log(instr.instr, instr);
      });

      msg.screens.forEach(function (screenupdate, idx) {
        console.log("Screen #" + idx + ": " + screenupdate.name);
        screenupdate.messages.forEach(function (screenmsg, idx) {
          console.log(idx, screenupdate.name + ':' + screenmsg.target, screenmsg.instr, screenmsg);
        });
      });
      console.groupEnd();
    }
    this.requireComponentTypes(this.getRequiredComponentTypes(msg), this.transformMessages.bind(this, msg));
  }

  async transformMessages(msg) {
    const promises = [];
    for (const screen of msg.screens)
      for (const screenmsg of screen.messages)
        if (screenmsg.instr === 'component') {
          const componenttype = this.shell.getComponentType(screenmsg.type);
          const promise = componenttype.asyncTransformMessage(screenmsg);
          if (promise)
            promises.push(promise);
        }

    if (promises.length)
      await Promise.all(promises);
    this.handleResponse(msg);
  }

  handleResponse(response) {
    let grabactivation = 0;

    // Id of formstate to send (0 is don't send), and whether to send synchronously
    let sendformstate = 0;
    let sendformstatesync = false;

    let isappinit = false;

    //ADDME Instead of a list of instructions, the server should simply transfer one JSON object, ready to reprocess
    const pendingreplies = [];

    response.instructions.forEach(function (instr) {
      const instrname = instr.instr;

      if (instrname === "shellinstruction")
        this.shell.executeInstruction(instr);
      else if (instrname === "reply")
        pendingreplies.push(instr);
      else if (instrname === "appdebuginfo") {
        instr.msg.trim().split('\n').forEach(line => console.log("APP:" + line));
      } else if (instrname === "init") {
        isappinit = true;
        this.applyAppInit(instr);
      } else if (instrname === "appupdate") {
        this.applyAppUpdate(instr);
      } else if (instrname === "grabactivation") {
        grabactivation = 1;
      } else if (instrname === "sendformstate") {
        if (sendformstate < instr.id)
          sendformstate = instr.id;
        sendformstatesync = sendformstatesync || instr.sync;
      } else if (instrname === "appcall") {
        this._executeAppCall(instr);
      } else {
        console.error("Unknown instruction '" + instrname + "' received");
      }
    }.bind(this));

    response.screens.forEach(screen => {
      const scr = this.getScreenByName(screen.name);
      if (scr)
        scr.processMessages(screen.messages);
      else
        this.createNewScreenObject(screen.name, screen.name + ':frame', screen.messages);
    });

    //Screens had a chance to process and request new locks, now we can release any locks associated with the original replies
    this.applyReceivedReplies(pendingreplies);

    if (grabactivation)
      this.shell.appmgr.activate(this);

    if (isappinit) {
      this._resolveAppLoad();
    }

    if (sendformstate) {
      // Server requested form state. Send asynchronously
      this.queueEvent('$formstate', sendformstate, sendformstatesync, null);
    }
  }

  async _executeAppCall(instr) {
    try {
      if (!this["_onMsg" + instr.type]) {
        console.error("No such app call type '" + instr.type + "'");
        throw new Error("No such app call type '" + instr.type + "'");
      }
      const result = await this["_onMsg" + instr.type].apply(this, instr.params);
      this.queueEvent("$controllermessage", { type: "clientcallreply", id: instr.id, resolve: true, result: result === undefined ? null : result });
    } catch (error) {
      console.log("Exception on appcall", error);
      this.queueEvent("$controllermessage", { type: "clientcallreply", id: instr.id, resolve: false, result: error.stack || String(error) });
    }
  }

  _gotLinkClosed() {
    this.appcomm = null;
    this.__startAppClose();

    // Remove event callbacks and queued events, won't be activated again
    this.eventcallbacks.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
    this.eventcallbacks = [];
    this.queuedEvents.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
    this.queuedEvents = [];

    this.deferred_close.resolve(); // wait max 5 secs for official close
    setTimeout(() => this.deferred_metamessage.resolve(null), 5000);
  }

  _closeApplication(metamessage) {
    // Remove the 'closing' busy lock
    this.__startAppClose();

    // Won't be referred by our whsid anymore
    this.whsid = '';

    if (!metamessage || (metamessage.type === "error" && !metamessage.errors.length)) {
      //It's just telling us our parent app has terminated. ADDME if we get no errors, but there are still screens open, there's still an issue!
      this.terminateApplication();
      return;
    }

    handleApplicationErrors(this, metamessage);
  }

  /****************************************************************************************************************************
  * Application updates
  */
  executeCommand(cmd) {
    switch (cmd.type) {
      case 'currentapp:controllermsg':
        this.queueEvent("$controllermessage", cmd.msg, true);
        break;
      default:
        super.executeCommand(cmd);
        break;
    }
  }

  applyAppUpdate(node) {
    switch (node.type) {
      case 'language':
        if (node.lang) {
          this.lang = node.lang;
          this.appnodes.root.lang = node.lang;
        }
        if (node.dateformat) {
          this.dateformat = node.dateformat;
        }
        if (node.timeformat) {
          this.timeformat = node.timeformat;
        }
        return;

      case 'target':
        this.apptarget = node.target;
        return;

      case 'apptab':
        this.hasissues = node.hasissues;
        this.appmenu = node.appmenu;
        this.isdebugged = false;
        this.updateApplicationProperties({
          title: node.title,
          appicon: node.icon
        });
        return;

      case "closescreen":
        var scr = this.getScreenByName(node.screen);
        if (!scr)
          console.error("App '" + this.appname + "' received close instruction for non-existing screen '" + node.screen + "'"); //ADDME test on harescript level - RunDialog with closing onshow? is this even reachable ?
        else
          scr.terminateScreen();
        return;

      case "callurl":
        var newwindow = window.open(node.url, node.target || "_blank");
        if (newwindow && newwindow.focus)
          try { newwindow.focus(); } catch (e) { console.log('New window focus failed: ' + e); }
        return;
    }
    console.error('Unexpected application update type: ' + node.type);
  }
  async launchApp() {
    this.notifyTopScreenChange();
    //FIXME whitelist options instead of deleting them
    const options = {
      ...this.options,
      onappbar: undefined,
      fixedonappbar: undefined,
      container: undefined,
      inbackground: undefined,
      browser: browser.getTriplet(),
      protocolversion: ToddProtocolVersion
    };

    try {
      const data = await this.shell.tolliumservice.startApp(this.appname, options);
      this.gotApplication(data);
      return;
    } catch (err) {
      console.warn("Unable to start the application due to an exception", err);
      await runSimpleScreen(this,
        {
          text: whintegration.config.dtapstage === 'development'
            ? getTid("tollium:shell.errors.appstartfailed-development")
            : getTid("tollium:shell.errors.appstartfailed"),
          buttons: [
            {
              name: 'close',
              title: getTid("~close")
            }
          ]
        });
      this.terminateApplication();
    }
  }
  gotApplication(data: AppStartResponse) {
    //ADDME dealing with subapps?

    //destroy any screens - FIXME why??
    if (!("status" in data) || data.status !== 'ok') {
      this.setAppTitle('Application');
      this._fireUpdateAppEvent();
      handleApplicationErrors(this, data);
      this._resolveAppLoad();
      return;
    }

    this.shell.registerApplicationFrontendLink(this, data, location.origin);

    const appstartmsg = data.appdata;
    if (appstartmsg.type === 'appstart') {
      //this.startoptions = options;

      this.start(data.frontendid);

      for (let i = 0; i < appstartmsg.data.messages.length; ++i) {
        this.lastinitmessage = appstartmsg.data.messages[i].seqnr;
        this.handleMessage(appstartmsg.data.messages[i].data);
      }
    }
  }

  failApplication(data) {
    console.warn("Unable to contact the application launch service. The application server may need a 'soft-reset'");
    console.log(data);
    alert("Unable to contact the application server."); //FIXME what to tell a user, really?
  }

  /****************************************************************************************************************************
   * Other stuff
   */

  queueUnloadMessage() {
    //no point in marking us synchronous, we may yet be reloaded
    //FIXME more robust unload mechanism - use a centrale queue and beacon ?

    /* skipStateTransfer: we don't want our message to be held up by awaits, that might cause a navigate away (or refresh) to not send the termination at all
       causing eg a RTD editor to collide against itself ('Tab already open')

       But this also restores RTE autosave. We need to come up with a better solution
       */
    this.queueEventNoLock('$terminate', '', false, null);
  }
}


/****************************************************************************************************************************
 * Global application functions
 */

export function registerJSApp(name: string, constructor: JSAppConstructor) {
  jsappconstructors[name] = constructor;
}
