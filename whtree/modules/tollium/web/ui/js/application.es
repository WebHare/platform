/* globals $shell $wh */
import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';

const $todd = require("./support");
const dombusy = require('dompack/src/busy');
const getTid = require("@mod-tollium/js/gettid").getTid;
const focusZones = require('../components/focuszones');
const preload = require('dompack/extra/preload');
const utilerror = require('@mod-system/js/wh/errorreporting');
import * as whconnect from '@mod-system/js/wh/connect';
import * as whintegration from '@mod-system/js/wh/integration';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
const toddImages = require("@mod-tollium/js/icons");

require("../common.lang.json");

/****************************************************************************************************************************
 *                                                                                                                          *
 *  APPLICATION                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/

var jsappconstructors = [];

/** Busy lock (while taken, the tollium app is busy
*/
class ApplicationBusyLock extends dombusy.Lock
{
  constructor(app)
  {
    super();
    this.app = app;
  }
  release()
  {
    super.release();
    this.app.removeBusyLock(this);
  }
}

//ADDME: Move these to SessionManager? A SessionManager would manage one user's session in a browser; the CommHandler
//       would manage one or more SessionManagers.

$todd.Application = class
{
  // ---------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(shell, appname, apptarget, parentapp, options)
  {
    this.container = null;
    /// Name of  app
    this.appname = '';
    this.appicon = '';
    this.visible = false;
    /// Target
    this.apptarget = {};
    /// Parent application
    this.parentapp = null;
    this.shell = null;
    this.tabmodifier = '';

  /// User config
  /// @{

    this.lang = '';
    this.dateformat = '';
    this.timeformat = '';

  ///@}

  /* the screenstack contains the screens currently displayed by this application (including foreign screens) in displayorder.
    screenstack.slice(-1)[0] is the currently active and only enabled screen */
    this.screenstack = [];
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

    this.busylocks = [];
    this.busysuppressors = {};

    /// Busy lock for application initialization
    this.initbusylock= null;
    /// Keep this app at the bottom of the application stack
    this.onappstackbottom= false;

    this._apploaddeferred = dompack.createDeferred();
    this._apploadlock = dompack.flagUIBusy();

    this.shell = shell;
    if(options)
    {
      this.container = options.container;
      options.container = null;
    }

    if(!this.container)
      this.container = dompack.qS('#desktop');

    this.options = { onappbar: true
                   , fixedonappbar: false
                   , ...options
                   };

    this.appname = appname;
    this.apptarget = apptarget || {};
    this.title = getTid("tollium:shell.loadingapp");

    this.appnodes = { root: dompack.create('div', { className:"appcanvas wh-focuszone"})
                    , appmodalitylayer: dompack.create('div', { className:"appmodalitylayer"
                                                              , childNodes: [ dompack.create("div", {className:"loader"}) ]
                                                            })
                    };
    this.appnodes.root.appendChild(this.appnodes.appmodalitylayer);
    this.container.appendChild(this.appnodes.root);

    if(parentapp)
    {
      this.parentapp = parentapp;
      this.options.onappbar=false;
    }

    this.setOnAppBar(this.options.onappbar, this.options.fixedonappbar);

    if(!parentapp)
      this.setVisible(true);

    if ($todd.IsDebugTypeEnabled('ui')) // Show busy locks when clicking on modality layer
      this.appnodes.appmodalitylayer.addEventListener('click', evt => this.showBusyFlags(evt));
  }

  destroy()
  {
    if(this.appnodes)
    {
      this.appnodes.root.remove();
      this.appnodes.appmodalitylayer.remove();
    }
    this._resolveAppLoad();
  }

  getLoadPromise()
  {
    return this._apploaddeferred.promise;
  }

  _resolveAppLoad()
  {
    this._apploaddeferred.resolve();
    if(this._apploadlock)
      this._apploadlock.release();
    this._apploadlock = null;
  }

  async resetApp()
  {
    let shutdownlock = this.getBusyLock();

    Object.keys(this.screenmap).forEach(screenname => this.screenmap[screenname].terminateScreen());

    if (this.appcomm)
    {
      // Close busy locks for sync messages - FIXME dangerous, calls should be rejectable promises and that should clear the locks
      this.eventcallbacks.forEach(e => { if (e.busylock) e.busylock.release(); if (e.callback) e.callback(); });
      this.eventcallbacks = [];
      this.queuedEvents = [];

      // Terminate the app
      if (this.appcomm)
        await this.queueEventAsync('$terminate', '');
      if (this.appcomm)
        this.appcomm.unregister();
      this.appcomm = null;
      this.whsid = null;
    }

    if (this.closebusylock)
    {
      this.closebusylock.release();
      this.closebusylock = null;
    }

    shutdownlock.release();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff: busy indication
  //

  getAppCanvas()
  {
    return this.appnodes.root;
  }

  removeBusyLock(lock)
  {
    let pos = this.busylocks.indexOf(lock);
    this.busylocks.splice(pos,1);

    $todd.DebugTypedLog("messages", "Busy lock released, now " + this.busylocks.length + " locks active");
    if(this.busylocks.length != 0) //still something up
      return;

//    this.setBusyFlag(Object.getLength(this.busylocks) && !Object.getLength(this.busysuppressors), false);

    // Are we still waiting for the busy indicator to show (short wait period)
    if (this.appbusytimeout)
    {
      // Indicator hasn't been shown yet, nothing to do
      clearTimeout(this.appbusytimeout);
      this.appbusytimeout = null;
    }
    else
    {
      // Indicator is being shown at the moment. Show done indicator
      this.appnodes.root.classList.add('isbusydone');

      // Remove everything after a small delay
      this.appunbusytimeout = setTimeout(() => this.undisplayBusy(), $todd.Application.busydonedelay);
    }

    // Remove the modality layer immediately
    this.appnodes.root.classList.remove('isbusy');
  }

  showBusyFlags()
  {
    console.log('Current busy locks:');
    window.$dompack$busylockmanager.logLocks();
  }

  displayBusy()
  {
    this.appnodes.root.classList.add("isbusyindicator");
    this.appbusytimeout = null;
  }

  undisplayBusy()
  {
    this.appnodes.root.classList.remove("isbusyindicator");
    this.appnodes.root.classList.remove("isbusydone");
    this.appunbusytimeout = null;
  }

  // ---------------------------------------------------------------------------
  //
  // Embedded application API: Base application functions
  //

  isBusy()
  {
    return this.appnodes.root.classList.contains('isbusy');
  }

  /// Load the requested component types, invoke 'callback' when they are loaded
  requireComponentTypes(requiredtypes, callback)
  {
    var unloaded_components = $shell.checkComponentsLoaded(requiredtypes, callback);
    if(unloaded_components.length)
      return;
    callback();
  }

  promiseComponentTypes(requiredtypes)
  {
    return new Promise(function(resolve, reject)
    {
      this.requireComponentTypes(requiredtypes, resolve);
    }.bind(this));
  }

  /// request a graceful close
  requestClose()
  {
    if(this.screenstack.length != 1) //modal dialog open
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
  getBusyLock()
  {
    let lock = new ApplicationBusyLock(this);
    this.busylocks.push(lock);

    if(this.busylocks.length > 1) //app already busy
      return lock;

    // Apply the modality layer
    this.appnodes.root.classList.add('isbusy'); //initially this just applies a modality layer

    // FIXME: calculate from real animation periods
    var animation_period_lcm = 6000;

    // Emulate that the animation is running continuously
    var loader = this.appnodes.root.querySelector(".loader");
    if (loader)
      loader.style.animationDelay = -(Date.now() % animation_period_lcm) + "ms";

    // Still showing busy indicators? Hide them immediately.
    if (this.appunbusytimeout)
    {
      clearTimeout(this.appunbusytimeout);
      this.undisplayBusy();
    }

    this.appbusytimeout = setTimeout( () => this.displayBusy(), $todd.Application.busyinitialwait);
    return lock;
  }

  setVisible(newvisible)
  {
    if(this.visible == newvisible)
      return;

    this.visible=newvisible;

    if(!this.visible)
    {
      if(this == $todd.applicationstack.slice(-1)[0]) //we're the currently selected app
      {
        if($todd.applicationstack.length >= 2)
          $todd.applicationstack[$todd.applicationstack.length-2].activateApp();
      }
      $todd.applicationstack = $todd.applicationstack.filter(app => app != this);
      this.shell.onApplicationStackChange();
    }
  }
  setOnAppBar(onappbar, fixedonappbar)
  {
    if($todd.applicationBar)
      $todd.applicationBar.toggleShortcut(this, onappbar, fixedonappbar);
  }

  updateApplicationProperties(props)
  {
    this.appicon = props.appicon;
    this.appiconwidth = props.appiconwidth || 16;
    this.appiconheight = props.appiconheight || 16;
    this.tabmodifier = props.tabmodifier || '';
    if("background" in props)
      this.appnodes.root.style.background = props.background ? props.background.css : "";

    this.setAppTitle(props.title);
    this._fireUpdateAppEvent();
  }
  _fireUpdateAppEvent()
  {
    dompack.dispatchCustomEvent(this.appnodes.root, "tollium:updateapp", { bubbles:true, cancelable:true});
  }
  createScreen(messages)
  {
    //create a new screen
    var name = 'localwin' + (++this.screencounter);
    return this.createNewScreenObject(name, 'frame', $todd.componentsToMessages(messages));
  }

  // ---------------------------------------------------------------------------
  //
  // Application state
  //
  isActiveApplication()
  {
    return this == $todd.applicationstack.slice(-1)[0];
  }
  activateApp()
  {
    let curapp = $todd.applicationstack.slice(-1)[0];

    if(curapp != this)
    {
      if(curapp)
      {
        //deactivate current application
        curapp.appnodes.root.classList.remove('visible');
      }

      //move us to the end
      $todd.applicationstack = $todd.applicationstack.filter(app => app != this);
      $todd.applicationstack.push(this);

      //if the previous app desired to be on the top, move it there. this keeps the dashboard from activating when closing one of multiple open apps
      if($todd.applicationstack.length >= 3 && $todd.applicationstack[$todd.applicationstack.length-2].onappstackbottom)
      {
        $todd.applicationstack.unshift($todd.applicationstack[$todd.applicationstack.length-2]);
        $todd.applicationstack.splice($todd.applicationstack.length-2,1);
      }

      dompack.dispatchCustomEvent(this.appnodes.root, "tollium:activateapp",
          { bubbles: true
          , cancelable: false
          });

      //activate
      this.appnodes.root.classList.add('visible');

      if($todd.applicationBar && this.apptab)
        $todd.applicationBar.setActiveShortcut(this.apptab);
      this.setAppTitle(this.title);
      this.shell.onApplicationStackChange();
    }

    if(this.screenstack.slice(-1)[0])
      this.screenstack.slice(-1)[0].focus();
    else
      focusZones.focusZone(this.appnodes.root);
  }

  //terminate an application, clearing all its screens (ADDME: what if we're hosting foreign screens?)
  terminateApplication()
  {
    this.setOnAppBar(false); //first leave the appbar, so 'reopen last app' in setVisible doesn't target us
    this.setVisible(false);

    $todd.applications = $todd.applications.filter(app => app != this);
    return this.resetApp().finally( () =>
    {
      this.destroy(); //FIXME dispose comm channels etc?
      $shell.onApplicationEnded(this);
    });
  }

  getToplevelApp()
  {
    for(var app = this; app.parentapp; app = app.parentapp)
      ;
    return app;
  }
  createNewScreenObject(windowname, framename, messages)
  {
    var screen = new $todd.Screen(this,
                                  { window: windowname
                                  , target: framename
                                  , specials:[]
                                  }, null);
    this.screenmap[windowname]=screen;
    if(messages)
      screen.processMessages(messages);

    var showapp = this.getToplevelApp();
    showapp.appnodes.root.appendChild(screen.getNode());
    screen.showScreen(showapp);

    return screen;
  }

  // ---------------------------------------------------------------------------
  //
  // Application settings
  //

  setAppTitle(newtitle)
  {
    this.title = newtitle;
    if ($todd.applicationstack.slice(-1)[0] == this)
    {
      let prefix = $shell.getCurrentSettings().browsertitleprefix;
      document.title = (prefix ? prefix + ' ' : '') + this.title;
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Application menu
  //

  generateAppMenu()
  {
    return this.appmenu.slice(0);
  }

  executeCommand(cmd)
  {
    //unknown, pass it to the shell
    this.shell.executeInstruction(cmd);
  }

  // ---------------------------------------------------------------------------
  //
  // Screen management
  //

  getScreenByName(windowname)
  {
    return this.screenmap[windowname];
  }

  // ---------------------------------------------------------------------------
  //
  // Message processors
  //

  _onMsgGetNotificationPermissionState()
  {
    // This function is called in a context the state may change, so let towl check too
    $todd.towl.updateForCurrentNotificationPermission();

    return window.Notification
        ? Notification.permission
        : "";
  }

  _onMsgShellReveal(path)
  {
    whconnect.revealInFinder(path);
  }

  async _onMsgOpenInEditor(path, loc, options)
  {
    let opener = whconnect.openInEditor(path, loc);
    if(options && options.closewindow)
    {
      await opener;
      this._onMsgCloseWindow();
    }
  }

  _onMsgAskWebHareConnect(message)
  {
    return whconnect.postToConnect(message);
  }

  _onMsgClearIconCache()
  {
    toddImages.resetImageCache();
    return true;
  }

  _onMsgCloseWindow()
  {
    window.close();
  }

  queueEventAsync(actionname, param)
  {
    return new Promise( (resolve, reject) =>
    {
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
  showExceptionDialog(e)
  {
    utilerror.reportException(e);
    runSimpleScreen(this,
                      { text: getTid("tollium:shell.errors.errortitle")
                      , buttons: [{ name: 'close', title: getTid("tollium:common.actions.close") }]
                      });
  }
};

$todd.Application.busyinitialwait=200;  //time before we show a loader
$todd.Application.busydonedelay=50;     //time before we start the 'done' fadeout

//An embedded application 'lives' in the tollium javascript. We better trust it...
$todd.FrontendEmbeddedApplication = class extends  $todd.Application
{
  constructor(shell, appname, apptarget, parentapp, options)
  {
    super(shell, appname, apptarget, parentapp, options);
  }
  loadApplication(manifest)
  {
    this.baseobject = manifest.baseobject;

    if(!jsappconstructors[this.baseobject])
    {
      let scr = $todd.FrontendEmbeddedApplication.scripts[manifest.baseobject];
      if(!scr)
      {
        scr = preload.promiseScript(manifest.src + "?__cd=" + Date.now());
        $todd.FrontendEmbeddedApplication.scripts[manifest.baseobject] = scr;
      }
      scr.then(result => this.onAppLoadComplete({success:true}));
    }
    else
    {
      this.onAppLoadComplete({success:true});
    }
  }
  onAppLoadComplete(event)
  {
    if(event.success && jsappconstructors[this.baseobject])
    {
      this.app = new jsappconstructors[this.baseobject](this, this.onAppInitComplete.bind(this));
      return;
    }

    console.error("Failed to load application " + this.baseobject); //FIXME how to deal with it?
    console.log(event);
  }
  onAppInitComplete(event)
  {
    this._resolveAppLoad();
  }
  queueEvent(actionname, param, synchronous, callback)
  {
    console.warn("Cannot handle event '" + actionname + "'",param);
  }

  queueUnloadMessage()
  {
    // No action needed in frontend apps
  }
};

$todd.FrontendEmbeddedApplication.scripts=[];

$todd.BackendApplication = class extends $todd.Application
{
  // ---------------------------------------------------------------------------
  //
  // Variables
  //

  /// Application metadata and communication


  constructor(shell, appname, apptarget, parentapp, options)
  {
    super(shell, appname, apptarget, parentapp, options);

    /// Application id
    this.whsid = '';


    /// Frontend id used for this application
    this.frontendid = '';

    /// Host for communication with backend
    this.commhost = '';

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

  applyAppInit(node)
  {
    this.whsid = node.whsid;
    this.commhost = node.commhost;
    this.lang = node.lang;
    if (this.lang)
      $todd.fallback.lang = this.lang;
    this.dateformat = node.dateformat;
    if (this.dateformat)
      $todd.fallback.dateformat = this.dateformat;
    this.timeformat = node.timeformat;
    if (this.timeformat)
      $todd.fallback.timeformat = this.timeformat;

    this.appcomm = new $todd.LinkEndPoint({ linkid: this.whsid, commhost: this.commhost, frontendid: this.frontendid });
    this.appcomm.onmessage = this.processMessage.bind(this);
    this.appcomm.onclosed = this._gotLinkClosed.bind(this);
    this.appcomm.registerManuallyReceivedMessage(this.lastinitmessage);

    this.appcomm.register($todd.transportmgr);

    // Wait for both link close & metamessage to close application
    this.deferred_close = dompack.createDeferred();
    this.deferred_metamessage = dompack.createDeferred();

    this.deferred_close.promise
        .then(function() { return this.deferred_metamessage.promise; }.bind(this)) // wait for metamessage and adopt the value
        .then(this._closeApplication.bind(this));
  }

  handleMetaMessage(data)
  {
    switch (data.type)
    {
      case "error":
      {
        if (data.appid != this.whsid)
          return; // this message is for an old app (we've restarted since then)

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

  handleMetaClose()
  {
    this.deferred_metamessage.resolve(null);
    setTimeout(this.deferred_close.resolve, 5000); // wait max 5 secs for link close
  }

  start(frontendid)
  {
    this.frontendid = frontendid;
  }

  restart()
  {
    let restartlock = this.getBusyLock();
    return this.resetApp().then( () =>
    {
      this.launchApp(true);
      restartlock.release();
    });
  }

/****************************************************************************************************************************
 * Communications
 */

  queueEvent(actionname, param, synchronous, originalcallback) //for legacy queueEvent calls, too many sitll remaining
  {
    let busylock = synchronous ? this.getBusyLock() : dompack.flagUIBusy();
    let finalcallback = () => { busylock.release(); if (originalcallback) originalcallback(); };
    this.queueEventNoLock(actionname, param, synchronous, finalcallback);
  }

  queueEventNoLock(actionname, param, synchronous, callback)
  {
    if (!this.appcomm)
      console.error("Trying to send event after the application link closed: ", actionname, param);

    this.queuedEvents.push(
        { actionname:   actionname
        , param:        param
        , synchronous:  synchronous
        , callback:     callback
        });

    this._sendQueuedEvents();
  }

  _sendQueuedEvents()
  {
    if (this.eventcallbacks.length != 0)
    {
      if (this.queuedEvents.length)
        console.log('Deferring sending queued events, still outstanding sync events');
      return;
    }

    if (!this.appcomm) // Not shut down already?
      return;

    var sentforms = false;
    while (this.queuedEvents.length)
    {
      var event = this.queuedEvents.shift();

      var response = { action:  event.actionname
                     , param:   event.param || ''
                     , forms:   []
                     , requirereply: true
                     };

      // Send forms only once per run of events
      if (!sentforms)
      {
        response.forms = Object.keys(this.screenmap).map(key => ({ name:key, fields:this.screenmap[key].getSubmitVariables() }));
        sentforms = true;
      }

      if($todd.IsDebugTypeEnabled('rpc'))
      {
        console.group("RPC log - outgoing. " + (response.requirereply?'sync':'async') + ", action: "+(event.actionname||'n/a')+', param:', event.param || '');
        for (var i=0;i<response.forms.length;++i)
        {
          console.group("form " + response.forms[i].name);
          Object.keys(response.forms[i].fields, key => console.log('comp ' + key+' value: ', response.forms[i].fields[key]));
          console.groupEnd();
        }
        console.groupEnd();
      }

      var seqnr = this.appcomm.queueMessage(response);
      this.eventcallbacks.push({ seqnr: seqnr, callback: event.callback });

      // Issue max 1 synchronous event at a time
      if (event.synchronous)
        break;
    }
  }

  applyReceivedReplies(replies)
  {
    // Execute callbacks for the events, and remove them from the callbacks array
    replies.forEach(reply =>
    {
      $todd.DebugTypedLog("messages", 'got reply for ', reply.seqnr);
      let pos = this.eventcallbacks.findIndex(callback => callback.seqnr == reply.seqnr);
      if (pos >= 0)
      {
        let rec = this.eventcallbacks.splice(pos, 1)[0];
        if (rec.callback)
          rec.callback(reply.replydata);
      }
    });

    this._sendQueuedEvents();
  }

  handleMessage(msgrec)
  {
    switch (msgrec.type)
    {
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

  getRequiredComponentTypes(msg)
  {
    var types=[];
    msg.screens.forEach(screen=>
      screen.messages.forEach(screenmsg =>
      {
        if(screenmsg.instr =='component' && !types.includes(screenmsg.type))
          types.push(screenmsg.type);
      }));
    return types;
  }

  processMessage(msg)
  {
    if($todd.IsDebugTypeEnabled('rpc'))
    {
      console.group("RPC log - incoming");
      console.log(msg);
      msg.instructions.forEach(function(instr)
        {
          console.log(instr.instr, instr);
        });

      msg.screens.forEach(function(screenupdate,idx)
        {
          console.log("Screen #" + idx + ": " + screenupdate.name);
          screenupdate.messages.forEach(function(screenmsg,idx)
            {
              console.log(idx,screenupdate.name + ':' + screenmsg.target,screenmsg.instr,screenmsg);
            });
        });
      console.groupEnd();
    }
    this.requireComponentTypes(this.getRequiredComponentTypes(msg), this.handleResponse.bind(this, msg));
  }

  handleResponse(response)
  {
    var grabactivation = 0;

    // Id of formstate to send (0 is don't send), and whether to send synchronously
    var sendformstate = 0;
    var sendformstatesync = false;

    var isappinit = false;

    //ADDME Instead of a list of instructions, the server should simply transfer one JSON object, ready to reprocess
    var pendingreplies = [];

    response.instructions.forEach(function(instr)
      {
        var instrname = instr.instr;

        if(instrname == "sendappmessage")
          this.shell.sendApplicationMessage(instr.app, instr.target, instr.message, instr.reuse);
        else if(instrname == "reply")
          pendingreplies.push(instr);
        else if(instrname == "appdebuginfo")
        {
          instr.msg.trim().split('\n').forEach(line => console.log("APP:" + line));
        }
        else if(instrname == "init")
        {
          isappinit=true;
          this.applyAppInit(instr);
        }
        else if(instrname == "appupdate")
        {
          this.applyAppUpdate(instr);
        }
        else if(instrname == "grabactivation")
        {
          grabactivation=1;
        }
        else if(instrname == "redirect")
        {
          if($wh.config.tollium.frontendmode)
            window.parent.location.href = instr.url;
          else
            console.warn("Ignoring redirection instruction, they are only accepted in frontend mode");
        }
        else if (instrname == "sendformstate")
        {
          if (sendformstate < instr.id)
            sendformstate = instr.id;
          sendformstatesync = sendformstatesync || instr.sync;
        }
        else if (instrname == "appcall")
        {
          this._executeAppCall(instr);
        }
        else
        {
          console.error("Unknown instruction '" + instrname + "' received");
        }
      }.bind(this));

    response.screens.forEach(screen =>
    {
      var scr = this.getScreenByName(screen.name);
      if(scr)
        scr.processMessages(screen.messages);
      else
        this.createNewScreenObject(screen.name, screen.name + ':frame', screen.messages);
    });

    //Screens had a chance to process and request new locks, now we can release any locks associated with the original replies
    this.applyReceivedReplies(pendingreplies);

    if(grabactivation)
      this.activateApp();

    if(isappinit)
    {
      this._resolveAppLoad();
    }

    if (sendformstate)
    {
      // Server requested form state. Send asynchronously
      this.queueEvent('$formstate', sendformstate, sendformstatesync, null);
    }
  }

  async _executeAppCall(instr)
  {
    try
    {
      if (!this["_onMsg" + instr.type])
      {
        console.error("No such app call type '" + instr.type + "'");
        throw new Error("No such app call type '" + instr.type + "'");
      }
      let result = await this["_onMsg" + instr.type].apply(this, instr.params);
      this.queueEvent("$controllermessage", { type: "clientcallreply", id: instr.id, resolve: true, result: result === undefined ? null : result});
    }
    catch(error)
    {
      this.queueEvent("$controllermessage", { type: "clientcallreply", id: instr.id, resolve: false, result: error.stack || error + "" });
    }
  }

  _gotLinkClosed()
  {
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

  _closeApplication(metamessage)
  {
    // Remove the 'closing' busy lock
    if (this.closebusylock)
    {
      this.closebusylock.release();
      this.closebusylock = null;
    }

    // Won't be referred by our whsid anymore
    this.whsid = null;

    if (!metamessage || !metamessage.errors.length)
    {
      //It's just telling us our parent app has terminated. ADDME if we get no errors, but there are still screens open, there's still an issue!
      this.terminateApplication();
      return;
    }

    $todd.handleApplicationErrors(this, metamessage);
  }

/****************************************************************************************************************************
* Application updates
*/
  executeCommand(cmd)
  {
    switch(cmd.type)
    {
      case 'currentapp:restart':
        this.restart();
        break;
      case 'currentapp:controllermsg':
        this.queueEvent("$controllermessage", cmd.msg, true);
        break;
      default:
        super.executeCommand(cmd);
        break;
    }
  }

  applyAppUpdate(node)
  {
    switch(node.type)
    {
      case 'language':
        if (node.lang)
        {
          this.lang = node.lang;
          $todd.fallback.lang = this.lang;
        }
        if (node.dateformat)
        {
          this.dateformat = node.dateformat;
          $todd.fallback.dateformat = this.dateformat;
        }
        if (node.timeformat)
        {
          this.timeformat = node.timeformat;
          $todd.fallback.timeformat = this.timeformat;
        }
        return;

      case 'target':
        this.apptarget = node.target;
        return;

      case 'apptab':
        this.hasissues = node.hasissues;
        this.appmenu = node.appmenu;
        this.isdebugged = false;
        this.updateApplicationProperties( { title: node.title
                                          , appicon: node.icon
                                          });
        return;

      case "closescreen":
        var scr = this.getScreenByName(node.screen);
        if(!scr)
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
    console.error('Unexpected application update type: ' +node.type);
  }
  async launchApp(restart)
  {
    let initlock = this.getBusyLock();
    //FIXME whitelist options instead of deleting them
    let options = { ...this.options
                  , onappbar: undefined
                  , fixedonappbar: undefined
                  , container: undefined
                  , inbackground: undefined
                  , browser: browser.getTriplet()
                  };

    try
    {
      let data = await this.shell.tolliumservice.async('StartApp', this.appname, options);
      this.gotApplication(data);
      initlock.release();
      return;
    }
    catch(err)
    {
      console.warn("Unable to start the application due to an exception", err);
      initlock.release();
      await runSimpleScreen(this,
                              { text: whintegration.config.dtapstage == 'development'
                                         ? getTid("tollium:shell.errors.appstartfailed-development")
                                         : getTid("tollium:shell.errors.appstartfailed")
                              , buttons: [ { name: 'close'
                                           , title: getTid("tollium:common.actions.close")
                                           }]
                              });
      this.terminateApplication();
    }
  }
  gotApplication(data)
  {
    //ADDME dealing with subapps?

    //destroy any screens - FIXME why??

    if (data.status != 'ok')
    {
      this.setAppTitle('Application');
      this._fireUpdateAppEvent();
      $todd.handleApplicationErrors(this, data);
      return;
    }

    this.shell.registerApplicationFrontendLink(data);

    var appstartmsg = data.appdata;
    if (appstartmsg.type == 'appstart')
    {
      //this.startoptions = options;

      this.start(data.frontendid);

      for (var i = 0; i < appstartmsg.data.messages.length; ++i)
      {
        this.lastinitmessage = appstartmsg.data.messages[i].seqnr;
        this.handleMessage(appstartmsg.data.messages[i].data);
      }
    }
  }

  failApplication(data)
  {
    console.warn("Unable to contact the application launch service. The application server may need a 'soft-reset'");
    console.log(data);
    alert("Unable to contact the application server."); //FIXME what to tell a user, really?
  }



/****************************************************************************************************************************
 * Other stuff
 */

  queueUnloadMessage()
  {
    //no point in marking us synchronous, we may yet be reloaded
    //FIXME more robust unload mechanism - use a centrale queue and beacon ?
    this.queueEvent('$terminate', '', false, null);
  }
};


/****************************************************************************************************************************
 * Global application functions
 */

$todd.frontendids = [];

$todd.getActiveApplication = function()
{
  return $todd.applicationstack.slice(-1)[0];
};

$todd.registerJSApp = function(name, constructor)
{
  jsappconstructors[name]=constructor;
};
