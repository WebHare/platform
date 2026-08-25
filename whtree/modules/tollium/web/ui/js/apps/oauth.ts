import * as $todd from "@mod-tollium/web/ui/js/support";
import * as utilerror from '@mod-system/js/wh/errorreporting';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { registerJSApp, type FrontendEmbeddedApplication } from "../application";
import "../../common.lang.json";
import { getTid } from "@webhare/gettid";
import { setupOauthRequestHandler } from "./oauth-support";
import type { ObjFrame } from "@mod-tollium/webdesigns/webinterface/components";
import { navigateTo } from "@webhare/env/src/navigation";

class OauthApp {
  oauthHandler;
  app;
  topscreen: ObjFrame | null = null;

  constructor(appinterface: FrontendEmbeddedApplication, callback: () => void) {
    this.oauthHandler = setupOauthRequestHandler(appinterface.shell.tolliumservice, location.href);
    this.app = appinterface;
    this.app.promiseComponentTypes(['panel', 'button', 'action', 'textedit', 'table']).then(this._setupScreen.bind(this)).then(callback).catch(utilerror.reportException); //If catch fails, use _catch
    this.app.updateApplicationProperties({ title: getTid("tollium:shell.oauth.apptitle"), appicon: 'tollium:objects/webhare' });
  }

  /** Returns a promise that an error messagebox is shown. When the user clicks close, the application is terminated.
      @param text Text to show
      @param callback Callback to call when the messagebox is closed by the user
  */
  async _showError(text: string) {
    await runSimpleScreen(this.app,
      {
        title: getTid("tollium:shell.oauth.errortitle"),
        text: text,
        buttons: [{ name: "close", title: getTid("~close") }]
      });
    void this.app.terminateApplication();
  }

  _setupScreen() {
    if ("error" in this.oauthHandler) {
      return this._showError(this.oauthHandler.error);
    }

    const screencomponents =
    {
      frame: {
        bodynode: 'root',
        specials: ["submitaction", "cancelaction"],
        allowresize: false,
        title: getTid("tollium:shell.oauth.oauthtitle"),
        defaultbutton: 'loginbutton'
      },

      root: {
        type: 'panel',
        lines: [
          { layout: "block", items: [{ item: "body" }], height: '1pr' },
          { layout: "block", items: [{ item: "footer" }], height: '1pr' }
        ],
        height: '1pr'
      },
      body: {
        type: 'panel',
        spacers: { bottom: true, top: true, left: true, right: true },
        lines: [
          {
            title: "",
            items: [
              {
                item: "explanation_text"
              }
            ],
            layout: "left"
          },
          {
            title: getTid("tollium:shell.oauth.clientid"),
            items: [
              {
                item: "clientid"
              }
            ]
          },
          /*
        , { title: getTid("tollium:shell.oauth.scopes")
          , items: [ { item: "scopes"
                     }
                   ]
          }*/
          {
            title: "",
            items: [
              {
                item: "question_text"
              }
            ],
            layout: "left"
          }
        ],
        width: '1pr'
      },
      footer: {
        type: 'panel',
        spacers: { bottom: true, top: true, left: true, right: true },
        lines: [
          {
            layout: "right",
            items: [
              { item: "submitbutton" },
              { item: "cancelbutton" }
            ]
          }
        ],
        isfooter: true,
        width: '1pr'
      },

      explanation_text: { type: "text", title: "", value: getTid("tollium:shell.oauth.explanation") },

      question_text: { type: "text", title: "", value: getTid("tollium:shell.oauth.question"), wordwrap: true, width: "1pr", minwidth: "70x" },

      clientid: { type: "text", title: "", value: this.oauthHandler.oauth_clientid },

      submitbutton: { type: "button", title: getTid("~yes"), action: "submitaction" },

      cancelbutton: { type: "button", title: getTid("~no"), action: "cancelaction" },

      submitaction: { type: "action", hashandler: true, onexecute: this._createAccessToken.bind(this) },

      cancelaction: { type: "action", hashandler: true, onexecute: this._sendCancel.bind(this) }
    };

    this.topscreen = this.app.createNewScreenObject('loginapp', 'frame', $todd.componentsToMessages(screencomponents));
  }

  async _createAccessToken(component: unknown, rule: unknown, callback: () => void) {
    if ("error" in this.oauthHandler)
      throw new Error("Oauth handler is in error state: " + this.oauthHandler.error);

    try {
      navigateTo(await this.oauthHandler.approve());
    } catch (e) {
      if (e instanceof Error)
        await utilerror.reportException(e);

      await this._showError(getTid("tollium:shell.oauth.messages.unknownerror"));
      callback();
    }
  }

  async _sendCancel(component: unknown, rule: unknown, callback: () => void) {
    if ("error" in this.oauthHandler)
      throw new Error("Oauth handler is in error state: " + this.oauthHandler.error);

    navigateTo(await this.oauthHandler.cancel());
    callback();
  }
}

registerJSApp('tollium:builtin.oauth', OauthApp);
