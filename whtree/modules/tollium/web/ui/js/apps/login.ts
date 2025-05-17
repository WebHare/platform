/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as frontend from '@webhare/frontend';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { type FrontendEmbeddedApplication, registerJSApp } from "../application";
import "../../common.lang.json";

import * as $todd from "@mod-tollium/web/ui/js/support";
import { getIndyShell } from '../shell';
import { navigateTo, type NavigateInstruction } from '@webhare/env/src/navigation';
import { getTid } from '@webhare/gettid';

import * as utilerror from '@mod-system/js/wh/errorreporting';
import type { ObjCheckbox, ObjFrame, ObjPanel, ObjTabs, ObjText, ObjTextEdit } from '@mod-tollium/webdesigns/webinterface/components';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- there's no real way to get everything below properly typesafe, we need a TS-redesign of frontend apps. use this type to indicate you're setting up inline tollium attributes
type TolliumInlineAttributes = any;

interface LoginMethodSSO {
  type: "saml" | "oidc";
  tag: string;
  ordering: number;
  autologin: boolean;
  title: string;
  icon: string;
  visibility: "always" | "revealsso";
}

interface LoginConfig {
  loginmethods: LoginMethodSSO[];
  passwordlogin: boolean;
  infotext: string;
  infotitle: string;
}

type Handler = {
  component: string;
  msgtype: string;
  handler: (data: any, callback: () => void) => void;
}

function shouldReveal(tag: string) {
  const urlreveal = new URL(location.href).searchParams.get("revealsso")?.toLowerCase();
  if (urlreveal && urlreveal.split(",").includes(tag.toLowerCase()))
    return true;

  return false;
}

class LoginApp {
  private readonly loginconfig: LoginConfig;
  private app: FrontendEmbeddedApplication;
  private topscreen!: ObjFrame; //TODO avoid '!' - but we build it a bit late. if promiseComponentTypes could be avoided in the construtor...
  private secondfactordata;

  constructor(appinterface: FrontendEmbeddedApplication, callback) {
    this.app = appinterface;
    this.app.promiseComponentTypes(['panel', 'button', 'action', 'textedit', 'table', 'hr']).then(this.setupScreen.bind(this)).then(callback).catch(utilerror.reportException); //If catch fails, use _catch
    this.loginconfig = this.app.apptarget;

    this.app.updateApplicationProperties({
      title: getTid("tollium:shell.login.apptitle"),
      appicon: 'tollium:objects/webhare',
      background: getIndyShell().settings.loginbg
    });
  }

  triggerWebHareSSO(tag: string) { //NOTE: exposing this API also recognized us as the login app
    const matchmethod = this.loginconfig.loginmethods.find(item => item.tag?.toLowerCase() === tag.toLowerCase());
    if (!matchmethod)
      return false;

    this.runSSOLogin(matchmethod.tag);
    return true;
  }
  setupScreen() {
    let screencomponents: Record<string, TolliumInlineAttributes> =
    {
      frame: {
        bodynode: 'root',
        specials: ['secondfactorloginaction', 'secondfactorlogincancelaction'],
        allowresize: false,
        title: getTid("tollium:shell.login.logintitle"),
        defaultbutton: ''
      },

      // Need this to throw warning line directly against the frame heading, without spacers between
      root: {
        type: 'panel',
        lines: [{ layout: "block", items: [{ item: "tabs" }] }],
        height: '1pr',
        width: '1pr'
      },

      tabs: {
        type: 'tabs',
        tabtype: 'server',
        pages: ["body", "secondfactor"],
        height: '1pr',
        width: '1pr',
        selected: "body"
      },

      body: {
        type: 'panel',
        lines: [],
        height: '1pr',
        width: '1pr',
        spacers: { top: true }
      },

      secondfactor: {
        type: "panel",
        lines: [
          { layout: "block", items: [{ item: "secondfactortop" }], height: '1pr' },
          { layout: "block", items: [{ item: "secondfactorfooter" }] }
        ],
        width: "1pr",
        height: "1pr",
        spacers: { top: true }
      },

      secondfactortop: {
        type: "panel",
        lines: [
          { layout: "left", items: [{ item: "secondfactorheading" }] },
          { layout: "left", items: [{ item: "secondfactorattemptsleft" }] },
          { title: getTid("tollium:shell.login.totpcode"), layout: "form", items: [{ item: "totpcode" }] }
        ],
        width: "1pr",
        height: "1pr",
        spacers: { bottom: true, left: true, right: true }
      },

      secondfactorheading:
        { type: "text", isheading: true, title: "", value: getTid("tollium:shell.login.secondfactorauthentication") },

      secondfactorattemptsleft:
        { type: "text", title: "", value: getTid("tollium:shell.login.secondfactorauthentication") },

      secondfactorfooter:
      {
        type: "panel",
        lines: [{ items: [{ item: 'secondfactorlogincancelbutton' }, { item: 'secondfactorloginbutton' }], layout: 'right' }],
        width: "1pr",
        isfooter: true,
        spacers: { left: true, right: true, bottom: true }
      },

      totpcode: { type: "textedit", autocomplete: "one-time-code", required: true, width: "20x", defaultbutton: "secondfactorloginbutton" },

      secondfactorlogincancelbutton:
        { type: "button", title: getTid("tollium:shell.login.cancel"), action: "secondfactorlogincancelaction" },
      secondfactorlogincancelaction:
        { type: "action", hashandler: true, unmasked_events: ["execute"] },

      secondfactorloginbutton:
        { type: "button", title: getTid("tollium:shell.login.loginbutton"), action: "secondfactorloginaction" },
      secondfactorloginaction:
        { type: "action", hashandler: true, unmasked_events: ["execute"] }

    };

    let handlers: Handler[] =
      [
        {
          component: "secondfactorloginaction",
          msgtype: "execute",
          handler: (data, callback) => this.executeSecondFactorLogin(data, callback)
        },
        {
          component: "secondfactorlogincancelaction",
          msgtype: "execute",
          handler: (data, callback) => this.executeCancelSecondFactorLogin(data, callback)
        }
      ];

    // Show login errors at the top of the screen
    const wrdauth_returned = (new URL(window.location.href)).searchParams.get("wrdauth_returned");
    let errormsg = "";
    switch (wrdauth_returned) {
      case "unknownlogin": // No account on this server (usually when using SAML)
        {
          errormsg = getTid("tollium:shell.login.nowebhareaccount");
        } break;
      case "error": // No account on this server (usually when using SAML)
        {
          errormsg = getTid("tollium:shell.login.genericerror");
        } break;
    }

    if (errormsg) {
      screencomponents.warningbar =
      {
        type: "panel",
        lines: [{ items: [{ item: "warningtext" }] }],
        backgroundcolor: "#FFFEE2",
        width: "1pr",
        borders: { bottom: true },
        spacers: { left: true, right: true, bottom: true }
      };
      screencomponents.warningtext =
      {
        type: "text",
        title: "",
        value: errormsg,
        wordwrap: true,
        width: "1pr"
      };

      // Place warning at top
      screencomponents.root.lines.unshift({ items: [{ item: "warningbar" }] });
    }

    // Have an infotext? Create a panel with the heading and (html) texts
    if (this.loginconfig.infotext) {
      screencomponents =
      {
        ...screencomponents,
        infopanel: {
          type: "panel",
          lines: [
            { layout: "left", items: [{ item: "infotitle" }] },
            { layout: "left", items: [{ item: "infotext" }] }
          ],
          width: "1pr",
          spacers: { left: true, right: true }
        },

        infotitle: { type: "text", isheading: true, title: "", value: this.loginconfig.infotitle || getTid("tollium:shell.login.infotitle") },

        infotext: {
          type: "text",
          title: "",
          value: this.loginconfig.infotext,
          ishtml: true,
          wordwrap: true,
          width: "1pr"
        }
      };
    }


    const visiblemethods = this.loginconfig.loginmethods.filter(item => !(item.visibility === "revealsso" && !shouldReveal(item.tag)));

    if (this.loginconfig.passwordlogin)
      this.setupPasswordLogin(screencomponents, handlers, visiblemethods.length === 0);

    for (const item of visiblemethods) {
      if (!screencomponents.samlpanel) {
        screencomponents =
        {
          ...screencomponents,
          samlpanel: {
            type: "panel",
            lines: [{ layout: "left", items: [{ item: "samlheading" }] }],
            width: "1pr",
            spacers: { left: true, bottom: true }
          },

          samlheading: { type: "text", isheading: true, title: "", value: getTid("tollium:shell.login.loginidentityservices") }
        };
      }

      const postfix = "_" + item.tag.toLowerCase();

      screencomponents.samlpanel.lines.push(
        {
          layout: "left",
          items: [{ item: 'image' + postfix }, { item: "text" + postfix }]
        });

      screencomponents["text" + postfix] =
      {
        type: "text",
        title: "",
        value: item.title,
        wordwrap: true,
        width: "1pr",
        action: "action" + postfix,
        underline: true
      };
      screencomponents["image" + postfix] =
      {
        type: "image",
        settings: { imgname: item.icon, width: 16, height: 16 },
        action: "action" + postfix,
        width: "16px",
        height: "16px",
        imgwidth: 16,
        imgheight: 16
      };

      screencomponents["action" + postfix] = { type: 'action', hashandler: true, unmasked_events: ['execute'] };

      screencomponents.frame.specials.push('action' + postfix);

      handlers.push(
        {
          component: "action" + postfix,
          msgtype: "execute",
          handler: (data, callback) => {
            this.runSSOLogin(item.tag);
            callback();
          }
        });

      /* autologin is disabled for now - we have no test coverage and probably won't even have users for it.
      if (item.autologin && item.type === "saml") //cant autologin with OIDC yet, that requires some sort of hint that is safe to try the redirect-loop
      {
        getIndyShell().wrdauth.startLogin(item.type, { action: 'postmessage', passive: true, allowlogout: item.allowlogout })
          .then(this.handlePassiveSAMLLogin)
          .catch(utilerror.reportException);
      }
      */

    }

    const method_panels = [];
    if (screencomponents.infopanel)
      method_panels.push("infopanel");
    if (screencomponents.loginpanel)
      method_panels.push("loginpanel");
    if (screencomponents.samlpanel)
      method_panels.push("samlpanel");

    method_panels.forEach((item, idx) => {
      if (idx !== 0) {
        screencomponents["hr_" + idx] =
        {
          type: "hr",
          width: "",
          enabled: true,
          minheight: "",
          minwidth: ""
        };
        screencomponents.body.lines.push({ layout: "block", items: [{ item: "hr_" + idx }] });
      }
      screencomponents.body.lines.push({ layout: "block", items: [{ item: item }] });
    });

    this.topscreen = this.app.createNewScreenObject('loginapp', 'frame', $todd.componentsToMessages(screencomponents));

    handlers.forEach(item => {
      this.topscreen.setMessageHandler(item.component, item.msgtype, item.handler);
    });
  }

  setupPasswordLogin(screencomponents: Record<string, TolliumInlineAttributes>, handlers: Handler[], isOnlyMethod: boolean) {
    let passwordresetlines: TolliumInlineAttributes[] = [];
    if (getIndyShell().settings.allowpasswordreset) {
      passwordresetlines = [{ layout: "right", items: [{ item: "forgotpassword" }] }];
    }

    Object.assign(screencomponents, {
      loginpanel: {
        type: "panel",
        lines: [
          { layout: "block", items: [{ item: "logintop" }] },
          { layout: "block", items: [{ item: "loginfooter" }] }
        ],
        width: "1pr",
        spacers: {}
      },

      logintop: {
        type: "panel",
        lines: [
          { layout: "left", items: [{ item: "loginheading" }] },
          { title: getTid("tollium:shell.login.username"), layout: "form", items: [{ item: "loginname" }] },
          { title: getTid("tollium:shell.login.password"), layout: "form", items: [{ item: "password" }] },
          ...passwordresetlines //only added if enabled
        ],
        width: "1pr",
        spacers: { bottom: true, left: true, right: true }
      },

      loginfooter: {
        type: "panel",
        lines: [{ title: "", layout: "left", items: [{ item: "loginbuttongrid" }] }],
        width: "1pr",
        isfooter: isOnlyMethod, // only when password is the only method
        spacers: { left: true, right: true, bottom: isOnlyMethod }
      },

      loginheading: { type: "text", isheading: true, title: "", value: getTid("tollium:shell.login.loginwithwebhareaccount") },

      loginname: { type: "textedit", required: true, width: "40x", minwidth: "20x", autocomplete: ["username"] },
      password: { type: "textedit", required: true, password: true, width: "40x", minwidth: "20x", autocomplete: ["current-password"] },

      forgotpassword: { type: "text", value: getTid("tollium:shell.login.forgotpassword"), action: "forgotaction", underline: true },
      forgotaction: { type: "action", hashandler: true, unmasked_events: ["execute"] },

      loginbutton: { type: "button", title: getTid("tollium:shell.login.loginbutton"), action: "loginaction" },
      loginaction: { type: "action", hashandler: true, unmasked_events: ["execute"] },

      savelogin: { type: "checkbox", name: "savelogin" },
      savelogintext: { type: "text", value: getTid("tollium:shell.login.savelogin"), labelfor: "savelogin" },

      loginbuttongrid: {
        type: 'table',
        cols: [{ "width": "1pr" }, { "width": "1pr" }],
        rowgroups: [
          {
            "height": "1pr",
            rows:
              [
                {
                  cells:
                    [
                      { name: "rememberpanel", colnum: 0, rownum: 0 },
                      { name: "buttonpanel", colnum: 1, rownum: 0 }
                    ]
                }
              ]
          }
        ],
        width: '1pr'
      },

      rememberpanel: {
        type: 'panel',
        lines: [
          {
            items: [
              { item: 'savelogin' },
              { item: 'savelogintext' }
            ],
            layout: 'left'
          }
        ],
        width: '1pr'
      },

      buttonpanel: {
        type: 'panel',
        lines: [{ items: [{ item: 'loginbutton' }], layout: 'right' }],
        width: '1pr'
      }
    });

    screencomponents.frame.specials.push('loginaction', 'forgotaction');
    screencomponents.frame.defaultbutton = "loginbutton";

    handlers.push({
      component: "loginaction",
      msgtype: "execute",
      handler: (data, callback) => void this.executePasswordLogin(data, callback)
    }, {
      component: "forgotaction",
      msgtype: "execute",
      handler: (data, callback) => void this.executeForgot(data, callback)
    });
  }

  handleSubmitInstruction(instr: NavigateInstruction, callback: () => void) {
    if (instr.type === "reload") {
      //no need to execute the submit instruction, it just redirects back to the shell..
      getIndyShell().wrdauth.refresh();
      getIndyShell().wrdauth.setupPage();
      getIndyShell().executeShell(); //this will prepare the dashboard app
      this.app.terminateApplication(); //and now we can terminate, application.length will stay above 0, preventing a window.close
      callback();
    } else {
      navigateTo(instr);
      return;
    }

  }

  async executePasswordLogin(data, callback: () => void) {
    const loginname = this.topscreen.getComponent<ObjTextEdit>('loginname')!.getSubmitValue().value;
    const password = this.topscreen.getComponent<ObjTextEdit>('password')!.getSubmitValue().value;
    const savelogin = this.topscreen.getComponent<ObjCheckbox>('savelogin')!.getSubmitValue().value;

    if (!loginname || !password) {
      const errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.enterusernameandpassword"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
      callback();
      return await errorscreen;
    }

    try {
      const result = await getIndyShell().wrdauth.login(loginname, password, { persistent: savelogin });
      if (result.submitinstruction) {
        this.handleSubmitInstruction(result.submitinstruction, callback);
        return;
      }
      if (result.code === "REQUIRESECONDFACTOR") {
        const selecttab = this.topscreen.getComponent<ObjPanel>('secondfactor')!;
        this.topscreen.getComponent<ObjTabs>('tabs')!.setSelected(selecttab.name, true);
        this.topscreen.getComponent<ObjFrame>('frame')!.setFocusTo('totpcode');

        this.secondfactordata = result.secondfactordata;
        this._updateSecondFactorText();
        callback();
        return;
      }
      if (result.code === "REQUIRESETUPSECONDFACTOR") {
        this.topscreen.getComponent<ObjTextEdit>('password')!.setValue("");
        const app = getIndyShell().startBackendApplication("system:managetwofactorauth", null,
          {
            onappbar: false,
            isloginapp: true,
            message: { setuplink: result.setuplink }
          });

        await app.getLoadPromise();
        callback();
        return;
      }
      if (result.code === "FAILEDVALIDATIONCHECKS") {
        this.topscreen.getComponent<ObjTextEdit>('password')!.setValue("");
        const app = getIndyShell().startBackendApplication("system:resetpassword", null,
          {
            onappbar: false,
            isloginapp: true,
            message: { passwordresetlink: result.passwordresetlink }
          });

        await app.getLoadPromise();
        callback();
        return;
      }

      return await this.handleGenericLoginError(result.code, callback);
    } catch (error) {
      if (callback)
        callback();
      this.app.showExceptionDialog(error);
    }
  }

  async handleGenericLoginError(code: string, callback: () => void) {
    const text = code === "LOGINCLOSED" ? getTid("tollium:shell.login.closedlogin")
      : code === "DISABLED" ? getTid("tollium:shell.login.disabledlogin")
        : getTid("tollium:shell.login.invalidlogin");
    const errorscreen = runSimpleScreen(this.app, { text: text, buttons: [{ name: 'ok', title: getTid("~ok") }] });
    callback();
    await errorscreen;
    location.reload();
  }

  async executeForgot(data, callback) {
    const app = getIndyShell().startBackendApplication("system:forgotpassword", this.app);
    await app.getLoadPromise();
    callback();
  }

  async runSSOLogin(tag: string) {
    const lock = this.topscreen!.lockScreen(); //NOTE we're not going to ever release it on the success path, as we're going to redirect away
    try {
      await frontend.startSSOLogin(tag);
    } catch (error) {
      lock.release(); //we only release the lock on the error path so we can keep the app locked while redirecting
      this.app.showExceptionDialog(error as Error);
    }
  }

  executeCancelSecondFactorLogin(data, callback) {
    const selecttab = this.topscreen.getComponent<ObjPanel>('body')!;
    this.topscreen.getComponent<ObjTabs>('tabs')!.setSelected(selecttab.name, true);

    this.secondfactordata = null;
    callback();
  }

  async executeSecondFactorLogin(data, callback) {
    // If a password manager focused the totp field while we don't have second factor data yet, execute the first login button's action
    if (!this.secondfactordata) {
      this.executePasswordLogin(data, callback);
      return;
    }
    const code = this.topscreen.getComponent<ObjTextEdit>('totpcode')!.getSubmitValue().value;
    const persistent = this.topscreen.getComponent<ObjCheckbox>('savelogin')!.getSubmitValue().value;

    const result = await getIndyShell().wrdauth.loginSecondFactor(this.secondfactordata.firstfactorproof, "totp", { code }, { persistent });
    if (result.submitinstruction) {
      this.handleSubmitInstruction(result.submitinstruction, callback);
      return;
    }

    switch (result.code) {
      case "INVALIDDATA":
        {
          this.secondfactordata = null;

          const errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.invaliddata"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
          callback();
          await errorscreen;

          // reload to login again
          location.reload();
        } break;

      case "TOTPLOCKED":
        {
          const errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totplocked"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
          callback();
          await errorscreen;
          this.secondfactordata = result.secondfactordata;
        } break;

      case "TOTPINVALIDCODE":
        {
          const errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totpinvalidcode"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
          callback();
          await errorscreen;
          this.secondfactordata = result.secondfactordata;
        } break;

      case "TOTPREUSEDCODE":
        {
          const errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totpreusedcode"), buttons: [{ name: 'ok', title: getTid("~ok") }] });
          callback();
          await errorscreen;
          this.secondfactordata = result.secondfactordata;
        } break;

      default:
        await this.handleGenericLoginError(result.code, callback);
        return;
    }

    this._updateSecondFactorText();
  }

  _updateSecondFactorText() {
    if (this.secondfactordata) {
      switch (this.secondfactordata.totpattemptsleft) {
        case 6:
          {
            this.topscreen.getComponent<ObjText>("secondfactorattemptsleft")!.setValue(getTid("tollium:shell.login.enterauthenticatorcode"));
          } break;
        case 0:
          {
            this.topscreen.getComponent<ObjText>("secondfactorattemptsleft")!.setValue(getTid("tollium:shell.login.enterbackupcode"));
          } break;
        default:
          {
            this.topscreen.getComponent<ObjText>("secondfactorattemptsleft")!.setValue(getTid("tollium:shell.login.totpattemptsleft", this.secondfactordata.totpattemptsleft.toString()));
          }
      }
    }
  }
}

window.triggerWebHareSSO = function (tag: string): boolean {
  //@ts-ignore -- Find the login app. clean this up but perhaps FedCM will offer a standard solution soon
  return $todd.applications.find(app => app.app?.triggerWebHareSSO)?.app.triggerWebHareSSO(tag) || false;
};

registerJSApp('tollium:builtin.login', LoginApp);
