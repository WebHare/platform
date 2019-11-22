var $todd = require("./support");
var getTid = require("@mod-tollium/js/gettid").getTid;
var utilerror = require('@mod-system/js/wh/errorreporting');
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
require("../common.lang.json");

"use strict";

class OauthApp
{

  constructor(appinterface, callback)
  {
    this.oauth_redirect = null;
    this.app = appinterface;
    this.app.promiseComponentTypes(['panel','button','action','textedit','table']).then(this._setupScreen.bind(this)).then(callback).catch(utilerror.reportException); //If catch fails, use _catch
    this.app.updateApplicationProperties({ title: getTid("tollium:shell.oauth.apptitle"), appicon: 'tollium:objects/webhare'});
  }

  /** Returns a promise that an error messagebox is shown. When the user clicks close, the application is terminated.
      @param text Text to show
      @param callback Callback to call when the messagebox is closed by the user
  */
  async _showError(text)
  {
    await runSimpleScreen(this.app,
                            { title: getTid("tollium:shell.oauth.errortitle")
                            , text: text
                            , buttons: [ { name: "close", title: getTid("tollium:common.buttons.close") }
                                       ]
                            });
    this.app.terminateApplication();
  }

  _setupScreen()
  {
    var url = new URL(location.href);

    this.oauth_clientid = url.searchParams.get("oauth_clientid");
    this.oauth_redirect = url.searchParams.get("oauth_redirect");
    var scopes = url.searchParams.get("oauth_scopes").split(",").filter(function(scope) { return scope; });
    this.oauth_scopes = scopes;

    var error = "";

    if (this.oauth_clientid == "")
      error = getTid("tollium:shell.oauth.messages.missing_client");
    else if (!scopes.length)
      error = getTid("tollium:shell.oauth.messages.missing_scopes");
    else if (this.oauth_redirect == "")
      error = getTid("tollium:shell.oauth.messages.missing_redirect");
    else if (this.oauth_redirect.indexOf(this.oauth_clientid))
      error = getTid("tollium:shell.oauth.messages.invalid_redirect");

    if (error)
      return this._showError(error);

    var screencomponents =
      { frame:        { bodynode: 'root'
                      , specials: [ "submitaction", "cancelaction" ]
                      , allowresize: false
                      , title: getTid("tollium:shell.oauth.oauthtitle")
                      , defaultbutton: 'loginbutton'
                      }

      , root:         { type: 'panel'
                      , lines: [ { items: [ { item:"body" } ], height:'1pr' }
                               , { items: [ { item:"footer" } ], height:'1pr' }
                               ]
                      , height:'1pr'
                      }
      , body:         { type: 'panel'
                      , spacers: { bottom: true, top: true, left: true, right: true }
                      , lines: [ { title: ""
                                 , items: [ { item: "explanation_text"
                                            }
                                          ]
                                 , layout: "left"
                                 }
                               , { title: getTid("tollium:shell.oauth.clientid")
                                 , items: [ { item: "clientid"
                                            }
                                          ]
                                 }
                               , { title: getTid("tollium:shell.oauth.scopes")
                                 , items: [ { item: "scopes"
                                            }
                                          ]
                                 }
                               , { title: ""
                                 , items: [ { item: "question_text"
                                            }
                                          ]
                                 , layout: "left"
                                 }
                               ]
                      , width:'1pr'
                      }
      , footer:       { type: 'panel'
                      , spacers: { bottom: true, top: true, left: true, right: true }
                      , lines: [ { layout: "right"
                                 , items: [ { item: "submitbutton" }
                                          , { item: "cancelbutton" }
                                          ]
                                 }
                               ]
                      , isfooter: true
                      , width:'1pr'
                      }

      , explanation_text: { type: "text", title: "", value: getTid("tollium:shell.oauth.explanation") }

      , question_text: { type: "text", title: "", value: getTid("tollium:shell.oauth.question") }

      , clientid:     { type: "text", title: "", value: this.oauth_clientid }

      , scopes:       { type: "text", title: "", value: this.oauth_scopes.join(", ") }

      , submitbutton: { type: "button", title: getTid("tollium:common.actions.yes"), action: "submitaction" }

      , cancelbutton: { type: "button", title: getTid("tollium:common.actions.no"), action: "cancelaction" }

      , submitaction: { type: "action", hashandler: true, onexecute: this._createAccessToken.bind(this)  }

      , cancelaction: { type: "action", hashandler: true, onexecute: this._sendCancel.bind(this) }
      };

    this.topscreen = this.app.createNewScreenObject('loginapp','frame',$todd.componentsToMessages(screencomponents));
  }

  async _createAccessToken(component, rule, callback)
  {
    try
    {
      var options =
          { type: "getoauthtoken"
          , scopes: this.oauth_scopes
          };

      const result = await $shell.tolliumservice.promiseRequest('ExecuteAction', [ options ]);

      var url = new URL(this.oauth_redirect);
      url.searchParams.set("responsetype", "token");
      url.searchParams.set("token", result.token);
      url.searchParams.set("scopes", result.scopes.join(","));
      url.searchParams.set("serverversion", result.serverversion);
      url.searchParams.set("expires", result.expires);
      location.href = url.toString();
    }
    catch (e)
    {
      if (e instanceof Error)
        utilerror.reportException(e);

      this._showError(getTid("tollium:shell.oauth.messages.unknownerror"));
      callback();
    }
  }

  _sendCancel(component, rule, callback)
  {
    var url = new URL(this.oauth_redirect);
    url.searchParams.set("responsetype", "cancel");
    location.href = url.toString();
    callback();
  }
}

$todd.registerJSApp('tollium:builtin.oauth', OauthApp);
