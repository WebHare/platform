/* eslint-disable */
// @ts-nocheck -- needs porting!

import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import Frame from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

import * as $todd from "@mod-tollium/web/ui/js/support";
import { Lock, flagUIBusy } from '@webhare/dompack';
import { getTid } from "@mod-tollium/js/gettid";
import * as focusZones from '../components/focuszones';
import { loadScript } from '@webhare/dompack';
import * as utilerror from '@mod-system/js/wh/errorreporting';
import * as whintegration from '@mod-system/js/wh/integration';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import LinkEndPoint from './comm/linkendpoint';
import DocPanel from "./application/docpanel";
import "./application/appcanvas.scss";
import * as toddImages from "@mod-tollium/js/icons";
import DirtyListener from '@mod-tollium/webdesigns/webinterface/components/frame/dirtylistener';
import IndyShell, { getIndyShell, handleApplicationErrors } from './shell';

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

/** Busy lock (while taken, the tollium app is busy
*/
class ApplicationBusyLock {
  private readonly lock: Lock;
  private readonly app: ApplicationBase;

  constructor(app: ApplicationBase) {
    this.lock = flagUIBusy();
    this.app = app;
  }
  release() {
    this.lock.release();
    this.app.removeBusyLock(this);
  }
}

//ADDME: Move these to SessionManager? A SessionManager would manage one user's session in a browser; the CommHandler
//       would manage one or more SessionManagers.

export class ApplicationBase {
  // ---------------------------------------------------------------------------
  //
  // Initialization
  //
  busylocks: ApplicationBusyLock[] = [];
  apptarget;

  /* the screenstack contains the screens currently displayed by this application (including foreign screens) in displayorder.
    screenstack.at(-1) is the currently active and only enabled screen */
  screenstack: Frame[] = [];

  dirtylisteners = new Array<DirtyListener>;

  /** Application name */
  appname: string;
  /** Parent application */
  parentapp: ApplicationBase | null = null;
  /** The shell starting us */
  shell: IndyShell; //(as if there would be more than one in a JS instace?)

  constructor(shell: IndyShell, appname: string, apptarget, parentapp: ApplicationBase | null, options?) {
    this.container = null;
    /// Name of  app
    this.appname = appname;
    this.appicon = '';
    this.visible = false;
    /// Target
    this.apptarget = {};

    this.shell = shell;
    this.tabmodifier = '';

    /// User config
    /// @{

    this.lang = '';
    this.dateformat = '';
    this.timeformat = '';

    ///@}

    /* the screenmap contains the screens owned by this application (never includes foreign windows) */
    this.screenmap = {};

    ///@}

    this.appisbusy = false;
    this.appisclosing = false;
    this.screencounter = 0;
    this.hasissues = false;
    this.isdebugged = false;
    this.isdebugpaused = false;
    this.appmenu = [];

    this.busysuppressors = {};

    /// Busy lock for application initialization
    this.initbusylock = null;
    /// Keep this app at the bottom of the application stack
    this.onappstackbottom = false;

    this._apploaddeferred = dompack.createDeferred();
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
    this.title = getTid("tollium:shell.loadingapp");

    this.appnodes.loader = <div class="appcanvas__loader" />;
    this.appnodes.appmodalitylayer = <div class="appcanvas__appmodalitylayer">{this.appnodes.loader}</div>;
    this.appnodes.docpanel = <div class="appcanvas__docpanel" />;
    this.appnodes.screens = <div class="appcanvas__screens">{this.appnodes.appmodalitylayer}</div>;
    this.appnodes.root = <div class="appcanvas wh-focuszone">{this.appnodes.screens}{this.appnodes.docpanel}</div>;

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

  destroy() {
    if (this.appnodes) {
      this.appnodes.root.remove();
      this.appnodes.appmodalitylayer.remove();
    }
    this._resolveAppLoad();
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

  async resetApp() {
    const shutdownlock = this.getBusyLock();

    if (this.appcomm) // Send a termination for the app. this flushes the contentsof any screens (ie dirty RTDs) to the server
      await this.queueEventAsync('$terminate', '');

    Object.keys(this.screenmap).forEach(screenname => this.screenmap[screenname].terminateScreen());

    if (this.appcomm) {
      // Close busy locks for sync messages - FIXME dangerous, calls should be rejectable promises and that should clear the locks
      this.eventcallbacks.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
      this.eventcallbacks = [];
      this.queuedEvents = [];

      if (this.appcomm)
        this.appcomm.close();
      this.appcomm = null;
      this.whsid = null;
    }

    if (this.closebusylock) {
      this.closebusylock.release();
      this.closebusylock = null;
    }

    shutdownlock.release();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff: busy indication
  //

  getAppCanvas() {
    return this.appnodes.screens;
  }

  removeBusyLock(lock: ApplicationBusyLock) {
    const pos = this.busylocks.indexOf(lock);
    this.busylocks.splice(pos, 1);

    $todd.DebugTypedLog("messages", "Busy lock released, now " + this.busylocks.length + " locks active");
    if (this.busylocks.length != 0) //still something up
      return;

    //    this.setBusyFlag(Object.getLength(this.busylocks) && !Object.getLength(this.busysuppressors), false);

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
    if (this.screenstack.length != 1) //modal dialog open
      return;
    this.screenstack[0].requestClose();
  }

  // ---------------------------------------------------------------------------
  //
  // Embedded application API: Application state management
  //

  /** Acquires a busy lock, returns the lock object. Can be closed with .close(). The application
      is busy until all busy locks are closed
  */
  getBusyLock() {
    const lock = new ApplicationBusyLock(this);
    this.busylocks.push(lock);

    if (this.busylocks.length > 1) //app already busy
      return lock;

    // Apply the modality layer
    this.appnodes.root.classList.add('appcanvas--isbusy'); //initially this just applies a modality layer

    // FIXME: calculate from real animation periods
    const animation_period_lcm = 6000;

    // Emulate that the animation is running continuously
    this.appnodes.loader.animationDelay = -(Date.now() % animation_period_lcm) + "ms";

    // Still showing busy indicators? Hide them immediately.
    if (this.appunbusytimeout) {
      clearTimeout(this.appunbusytimeout);
      this.undisplayBusy();
    }

    this.appbusytimeout = setTimeout(() => this.displayBusy(), busyinitialwait);
    return lock;
  }

  setVisible(newvisible) {
    if (this.visible == newvisible)
      return;

    this.visible = newvisible;

    if (!this.visible) {
      if (this == $todd.applicationstack.at(-1)) //we're the currently selected app
      {
        if ($todd.applicationstack.length >= 2)
          $todd.applicationstack[$todd.applicationstack.length - 2].activateApp();
      }

      const apppos = $todd.applicationstack.indexOf(this);
      if (apppos >= 0)
        $todd.applicationstack.splice(apppos, 1);

      this.shell.onApplicationStackChange();
    }
  }
  setOnAppBar(onappbar, fixedonappbar) {
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
    return this == $todd.applicationstack.at(-1);
  }
  activateApp() {
    const curapp = $todd.applicationstack.at(-1);

    if (curapp != this) {
      if (curapp) {
        //deactivate current application
        curapp.appnodes.root.classList.remove('appcanvas--visible');
      }

      //move us to the end
      const apppos = $todd.applicationstack.indexOf(this);
      if (apppos >= 0)
        $todd.applicationstack.splice(apppos, 1);

      $todd.applicationstack.push(this);

      //if the previous app desired to be on the top, move it there. this keeps the dashboard from activating when closing one of multiple open apps
      if ($todd.applicationstack.length >= 3 && $todd.applicationstack[$todd.applicationstack.length - 2].onappstackbottom) {
        $todd.applicationstack.unshift($todd.applicationstack[$todd.applicationstack.length - 2]);
        $todd.applicationstack.splice($todd.applicationstack.length - 2, 1);
      }

      dompack.dispatchCustomEvent(this.appnodes.root, "tollium:activateapp",
        {
          bubbles: true,
          cancelable: false
        });

      //activate
      this.appnodes.root.classList.add('appcanvas--visible');

      this.setAppTitle(this.title);
      this.shell.onApplicationStackChange();
    }

    if (this.screenstack.at(-1))
      this.screenstack.at(-1).focus();
    else
      focusZones.focusZone(this.appnodes.root);
  }

  //terminate an application, clearing all its screens (ADDME: what if we're hosting foreign screens?)
  terminateApplication() {
    this.setOnAppBar(false); //first leave the appbar, so 'reopen last app' in setVisible doesn't target us
    this.setVisible(false); //also removes us from $todd.applications

    const apppos = $todd.applications.indexOf(this);
    if (apppos >= 0)
      $todd.applications.splice(apppos, 1);

    return this.resetApp().finally(() => {
      this.destroy(); //FIXME dispose comm channels etc?
      this.shell.onApplicationEnded(this);
    });
  }

  getToplevelApp(): ApplicationBase {
    return this.parentapp?.getToplevelApp() || this;
  }

  createNewScreenObject(windowname, framename, messages) {
    const screen = new Frame(this, {
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

    return screen;
  }

  // ---------------------------------------------------------------------------
  //
  // Application settings
  //

  setAppTitle(newtitle) {
    this.title = newtitle;
    if ($todd.getActiveApplication() == this) {
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

    /// Application id
    this.whsid = '';


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

    this.closebusylock = null;

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
    this.deferred_close = dompack.createDeferred();
    this.deferred_metamessage = dompack.createDeferred();

    this.deferred_close.promise
      .then(function () { return this.deferred_metamessage.promise; }.bind(this)) // wait for metamessage and adopt the value
      .then(this._closeApplication.bind(this));
  }

  handleMetaMessage(data) {
    switch (data.type) {
      case "error":
      case "expired":
        {
          if (!this.closebusylock)
            this.closebusylock = this.getBusyLock();

          this.deferred_metamessage.resolve(data);
          setTimeout(this.deferred_close.resolve, 5000); // wait max 5 secs for link close

          this.appisclosing = true;
        } break;

      case "debugstatus":
        {
          this.isdebugged = data.attached;
          this.isdebugpaused = data.paused;
          this._fireUpdateAppEvent();
        } break;
    }
  }

  handleMetaClose() {
    this.deferred_metamessage.resolve(null);
    setTimeout(this.deferred_close.resolve, 5000); // wait max 5 secs for link close
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

  queueEvent(actionname, param, synchronous, originalcallback) //for legacy queueEvent calls, too many sitll remaining
  {
    const busylock = synchronous ? this.getBusyLock() : dompack.flagUIBusy();
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
      const pos = this.eventcallbacks.findIndex(callback => callback.seqnr == reply.seqnr);
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
        if (screenmsg.instr == 'component' && !types.includes(screenmsg.type))
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
        if (screenmsg.instr == 'component') {
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

      if (instrname == "shellinstruction")
        this.shell.executeInstruction(instr);
      else if (instrname == "reply")
        pendingreplies.push(instr);
      else if (instrname == "appdebuginfo") {
        instr.msg.trim().split('\n').forEach(line => console.log("APP:" + line));
      } else if (instrname == "init") {
        isappinit = true;
        this.applyAppInit(instr);
      } else if (instrname == "appupdate") {
        this.applyAppUpdate(instr);
      } else if (instrname == "grabactivation") {
        grabactivation = 1;
      } else if (instrname == "redirect") {
        if (whintegration.config.tollium.frontendmode)
          window.parent.location.href = instr.url;
        else
          console.warn("Ignoring redirection instruction, they are only accepted in frontend mode");
      } else if (instrname == "sendformstate") {
        if (sendformstate < instr.id)
          sendformstate = instr.id;
        sendformstatesync = sendformstatesync || instr.sync;
      } else if (instrname == "appcall") {
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
      this.activateApp();

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
    if (!this.closebusylock)
      this.closebusylock = this.getBusyLock();

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
    if (this.closebusylock) {
      this.closebusylock.release();
      this.closebusylock = null;
    }

    // Won't be referred by our whsid anymore
    this.whsid = null;

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
    const initlock = this.getBusyLock();
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
      initlock.release();
      return;
    } catch (err) {
      console.warn("Unable to start the application due to an exception", err);
      initlock.release();
      await runSimpleScreen(this,
        {
          text: whintegration.config.dtapstage == 'development'
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
  gotApplication(data) {
    //ADDME dealing with subapps?

    //destroy any screens - FIXME why??
    if (data.status != 'ok') {
      this.setAppTitle('Application');
      this._fireUpdateAppEvent();
      handleApplicationErrors(this, data);
      this._resolveAppLoad();
      return;
    }

    this.shell.registerApplicationFrontendLink({ ...data, commhost: location.origin });

    const appstartmsg = data.appdata;
    if (appstartmsg.type == 'appstart') {
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
