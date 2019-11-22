/** A basic javascript application */

class TestJSApp
{
  constructor(appinterface, callback)
  {
    this.app = appinterface;

    this.app.updateApplicationProperties({title:'We are live!'});
    this.app.requireComponentTypes(['panel','button','action'], this.continueApp.bind(this, callback));
  }
  continueApp(callback)
  {
    var topscreen = this.app.createNewScreenObject('jsapptop','frame',$tollium.componentsToMessages(
      { frame:       { bodynode: 'body', specials: ['popupaction','remoteaction'], allowresize: true } //ADDME can't we remove the requirement for 'actions' (perhaps just move them to the end of the visibility order?)
      , body:        { type: 'panel', lines: [{ title: 'Hello, World', items: [{item:"popup"},{item:"remote"}] }]
                     }
      , popup:       { type: 'button', title: 'Open a popup!', action: 'popupaction' }
      , popupaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      , remote:      { type: 'button', title: 'Open a remote app', action: 'remoteaction' }
      , remoteaction:{ type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      }));

    topscreen.setMessageHandler("popupaction", "execute", this.executePopup.bind(this));
    topscreen.setMessageHandler("remoteaction", "execute", this.executeRemote.bind(this));

    callback();
  }

  executePopup(data, callback)
  {
    callback();

    //launch a popup
    var popupwindow = this.app.createScreen(
      { frame:       { bodynode: 'body' }
      , body:        { type: 'panel', lines: [{title: 'You opened a popup'}] }
      });

    //ADDME todd needs an auto-close
    popupwindow.setMessageHandler("frame", "close", this.closePopup.bind(this, popupwindow));
  }
  closePopup(win, data, callback)
  {
    win.updateScreen(
      { frame:       { messages: [ {type: "close"} ]}
      });
    callback();
  }

  executeRemote(data, callback)
  {
    //launch an application to host the remote process, but do not register it as a tab
    var app = $shell.startBackendApplication('webhare_testsuite:runscreen(tests/basecomponents.windowtest)', this.app);
    app.getLoadPromise().then(this.gotRemoteApp.bind(this,callback));
  }
  gotRemoteApp( finalcallback, event)
  {
    //this.app.runAppAsForeignScreen(event.target);
    finalcallback();
  }
}

$tollium.registerJSApp('TestJSApp', TestJSApp);
