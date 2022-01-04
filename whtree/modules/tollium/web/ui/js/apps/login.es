/* globals $shell */
import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { registerJSApp } from "../application.es";
import"../../common.lang.json";

import $todd from "@mod-tollium/web/ui/js/support";
var getTid = require("@mod-tollium/js/gettid").getTid;
var utilerror = require('@mod-system/js/wh/errorreporting');

class LoginApp
{ constructor(appinterface, callback)
  {
    this.app = appinterface;
    this.app.promiseComponentTypes(['panel','button','action','textedit','table','hr']).then(this.setupScreen.bind(this)).then(callback).catch(utilerror.reportException); //If catch fails, use _catch
    this.app.updateApplicationProperties({ title: getTid("tollium:shell.login.apptitle")
                                         , appicon: 'tollium:objects/webhare'
                                         , background: $shell.settings.loginbg
                                         });
  }
  setupScreen()
  {
    var screencomponents =
      { frame:        { bodynode: 'root'
                      , specials: ['secondfactorloginaction','secondfactorlogincancelaction']
                      , allowresize: false
                      , title: getTid("tollium:shell.login.logintitle")
                      , defaultbutton: ''
                      }

        // Need this to throw warning line directly against the frame heading, without spacers between
      , root:         { type: 'panel'
                      , lines: [ { layout: "block", items: [ { item: "tabs"} ] } ]
                      , height: '1pr'
                      , width:'1pr'
                      }

      , tabs:         { type: 'tabs'
                      , tabtype: 'server'
                      , pages: [ "body", "secondfactor" ]
                      , height: '1pr'
                      , width:'1pr'
                      , selected: "body"
                      }

      , body:         { type: 'panel'
                      , lines: []
                      , height: '1pr'
                      , width:'1pr'
                      , spacers: { top: true }
                      }

      , secondfactor:   { type:   "panel"
                        , lines:  [ { layout: "block", items:[ { item:"secondfactortop" } ], height:'1pr' }
                                  , { layout: "block", items:[ { item:"secondfactorfooter" } ] }
                                  ]
                        , width:  "1pr"
                        , height: "1pr"
                        , spacers: { }
                        }

      , secondfactortop:{ type:   "panel"
                        , lines:  [ { layout: "left", items:[ { item:"secondfactorheading" } ] }
                                  , { layout: "left", items:[ { item:"secondfactorattemptsleft" } ] }
                                  , { title: getTid("tollium:shell.login.totpcode"), layout: "form", items:[ { item:"totpcode" } ] }
                                  ]
                        , width:  "1pr"
                        , height: "1pr"
                        , spacers: { bottom:true, left:true, right: true }
                        }

      , secondfactorheading:
                        { type: "text", isheading: true, title: "", value: getTid("tollium:shell.login.secondfactorauthentication") }

      , secondfactorattemptsleft:
                        { type: "text", title: "", value: getTid("tollium:shell.login.secondfactorauthentication") }

      , secondfactorfooter:
                        { type:   "panel"
                        , lines:  [ { items: [ { item: 'secondfactorlogincancelbutton' }, { item:'secondfactorloginbutton' } ], layout:'right' } ]
                        , width:  "1pr"
                        , isfooter: true
                        , spacers: { left:true, right: true, bottom: true }
                        }

      , totpcode:       { type: "textedit", required: true, width: "20x", defaultbutton: "secondfactorloginbutton" }

      , secondfactorlogincancelbutton:
                        { type: "button", title: getTid("tollium:shell.login.cancel"), action: "secondfactorlogincancelaction" }
      , secondfactorlogincancelaction:
                        { type: "action", hashandler: true, unmasked_events: ["execute"] }

      , secondfactorloginbutton:
                        { type: "button", title: getTid("tollium:shell.login.loginbutton"), action: "secondfactorloginaction" }
      , secondfactorloginaction:
                        { type: "action", hashandler: true, unmasked_events: ["execute"] }

      };

    let handlers =
        [ { component:  "secondfactorloginaction"
          , msgtype :   "execute"
          , handler:    (data,callback) => this.executeSecondFactorLogin(data,callback)
          }
        , { component:  "secondfactorlogincancelaction"
          , msgtype :   "execute"
          , handler:    (data,callback) => this.executeCancelSecondFactorLogin(data,callback)
          }
        ];

    // Show login errors at the top of the screen
    var wrdauth_returned = (new URL(window.location.href)).searchParams.get("wrdauth_returned");
    var errormsg = "";
    switch (wrdauth_returned)
    {
      case "unknownlogin": // No account on this server (usually when using SAML)
      {
        errormsg = getTid("tollium:shell.login.nowebhareaccount");
      } break;
      case "error": // No account on this server (usually when using SAML)
      {
        errormsg = getTid("tollium:shell.login.genericerror");
      } break;
    }

    if (errormsg)
    {
      screencomponents.warningbar =
          { type: "panel"
          , lines: [ { items: [ { item:"warningtext" } ] } ]
          , backgroundcolor: "#FFFEE2"
          , width: "1pr"
          , borders: { bottom: true }
          , spacers: { left: true, right: true, bottom: true }
          };
      screencomponents.warningtext =
          { type: "text"
          , title: ""
          , value: errormsg
          , wordwrap: true
          , width: "1pr"
          };

      // Place warning at top
      screencomponents.root.lines.unshift({ items: [ { item: "warningbar" } ] });
    }

    // Have an infotext? Create a panel with the heading and (html) texts
    if (this.app.apptarget.infotext)
    {
      screencomponents =
          { ...screencomponents
          , infopanel:      { type:   "panel"
                            , lines:  [ { layout: "left", items:[ { item:"infotitle" } ] }
                                      , { layout: "left", items:[ { item:"infotext" } ] }
                                      ]
                            , width:  "1pr"
                            , spacers: { left: true, right: true }
                            }

          , infotitle:    { type: "text", isheading: true, title: "", value: this.app.apptarget.infotitle || getTid("tollium:shell.login.infotitle") }

          , infotext:       { type: "text"
                            , title: ""
                            , value: this.app.apptarget.infotext
                            , ishtml: true
                            , wordwrap:true
                            , width: "1pr"
                            }
          };
    }

    let passwordresetlines = [];
    if($shell.settings.allowpasswordreset)
    {
      passwordresetlines = [{ layout: "right", items:[ { item:"forgotpassword" } ] }];
    }

    this.app.apptarget.methods.forEach(item =>
    {
      switch (item.type)
      {
        case "saml":
        case "oidc":
        {
          if (!screencomponents.samlpanel)
          {
            screencomponents =
                { ...screencomponents
                , samlpanel:      { type:   "panel"
                                  , lines:  [ { layout: "left", items:[ { item:"samlheading" } ] }
                                            ]
                                  , width:  "1pr"
                                  , spacers: { left: true, bottom: true }
                                  }

                , samlheading:    { type: "text", isheading: true, title: "", value: item.loginprompt || getTid("tollium:shell.login.loginidentityservices") }
                };
          }

          var postfix = "_" + item.tag.toLowerCase();

          screencomponents.samlpanel.lines.push(
              { layout: "left"
              , items: [ { item:'image' + postfix }, { item: "text" + postfix } ]
              });

          screencomponents["text" + postfix] =
              { type: "text"
              , title: ""
              , value: item.title
              , wordwrap: true
              , width: "1pr"
              , action: "action" + postfix
              , underline: true
              };
          screencomponents["image" + postfix] =
              { type: "image"
              , settings: { imgname: item.icon, width: 16, height: 16 }
              , action: "action" + postfix
              , width: "16px"
              , height: "16px"
              , imgwidth: 16
              , imgheight: 16
              };

          screencomponents["action" + postfix] = { type: 'action', hashandler: true, unmasked_events: ['execute'] };

          screencomponents.frame.specials.push('action' + postfix);

          handlers.push(
              { component:  "action" + postfix
              , msgtype :   "execute"
              , handler:    this.executeSAMLLogin.bind(this, item)
              });

          if (item.autologin && item.type == "saml") //cant autologin with OIDC yet, that requires some sort of hint that is safe to try the redirect-loop
          {
            $shell.wrdauth.startLogin(item.type, { action: 'postmessage', passive: true, allowlogout: item.allowlogout })
                .then(this.handlePassiveSAMLLogin)
                .catch(utilerror.reportException);
          }

        } break;

        case "password":
        {
          let is_only_method = this.app.apptarget.methods.length == 1;
          screencomponents =
              { ...screencomponents
              , loginpanel:     { type:   "panel"
                                , lines:  [ { layout: "block", items:[ { item:"logintop" } ] }
                                          , { layout: "block", items:[ { item:"loginfooter" } ] }
                                          ]
                                , width:  "1pr"
                                , spacers: { }
                                }

              , logintop:       { type:   "panel"
                                , lines:  [ { layout: "left", items:[ { item:"loginheading" } ] }
                                          , { title: getTid("tollium:shell.login.username"), layout: "form", items:[ { item:"loginname" } ] }
                                          , { title: getTid("tollium:shell.login.password"), layout: "form", items:[ { item:"password" } ] }
                                          , ...passwordresetlines //only added if enabled
                                          ]
                                , width:  "1pr"
                                , spacers: { bottom:true, left:true, right: true }
                                }

              , loginfooter:    { type:   "panel"
                                , lines:  [ { title: "", layout: "left", items: [ { item: "loginbuttongrid" } ] }
                                        ]
                                , width:  "1pr"
                                , isfooter: is_only_method // only when password is the only method
                                , spacers: { left:true, right: true, bottom: is_only_method }
                                }

              , loginheading:   { type: "text", isheading: true, title: "", value: item.loginprompt || getTid("tollium:shell.login.loginwithwebhareaccount") }

              , loginname:      { type: "textedit", required: true, width: "40x", minwidth: "20x", autocomplete: ["username"] }
              , password:       { type: "textedit", required: true, password: true, width: "40x", minwidth: "20x", autocomplete: ["current-password"] }

              , forgotpassword: { type: "text", value: getTid("tollium:shell.login.forgotpassword"), action: "forgotaction", underline: true  }
              , forgotaction:   { type: "action", hashandler: true, unmasked_events: ["execute"] }

              , loginbutton:    { type: "button", title: getTid("tollium:shell.login.loginbutton"), action: "loginaction" }
              , loginaction:    { type: "action", hashandler: true, unmasked_events: ["execute"] }

              , savelogin:      { type: "checkbox", name: "savelogin" }
              , savelogintext:  { type: "text", value: getTid("tollium:shell.login.savelogin"), labelfor:"savelogin" }

              , loginbuttongrid:{ type:'table'
                                , cols: [ { "width":"1pr" }, { "width":"1pr" } ]
                                , rowgroups:  [ { "height":"1pr"
                                                , rows:
                                                    [ { cells:
                                                          [ { name: "rememberpanel",colnum:0, rownum:0 }
                                                          , { name: "buttonpanel",colnum:1,rownum:0 }
                                                          ]
                                                      }
                                                    ]
                                                }
                                              ]
                                , width:'1pr'
                                }

              , rememberpanel:  { type: 'panel'
                                , lines:  [ { items: [ {item:'savelogin'}
                                                     , {item:'savelogintext'}
                                                     ]
                                            , layout:'left'
                                            }
                                          ]
                                , width:'1pr'
                                }

              , buttonpanel:    { type: 'panel'
                                , lines: [ {items: [{item:'loginbutton'}],layout:'right'} ]
                                , width:'1pr'
                                }
              };

          screencomponents.frame.specials.push('loginaction','forgotaction');
          screencomponents.frame.defaultbutton = "loginbutton";

          handlers = [ ...handlers
                     , { component:  "loginaction"
                       , msgtype :   "execute"
                       , handler:    (data,callback) => this.executePasswordLogin(data,callback)
                       }
                     , { component:  "forgotaction"
                       , msgtype :   "execute"
                       , handler:    (data,callback) => this.executeForgot(data,callback)
                       }
                     ];
        } break;
      }
    });

    var method_panels = [];
    if (screencomponents.infopanel)
      method_panels.push("infopanel");
    if (screencomponents.loginpanel)
      method_panels.push("loginpanel");
    if (screencomponents.samlpanel)
      method_panels.push("samlpanel");

    method_panels.forEach((item, idx) =>
    {
      if (idx != 0)
      {
        screencomponents["hr_" + idx] =
              { type: "hr"
              , width: ""
              , enabled: true
              , minheight: ""
              , minwidth: ""
              };
        screencomponents.body.lines.push({ layout: "block", items: [ { item: "hr_" + idx } ] });
      }
      screencomponents.body.lines.push({ layout: "block", items: [ { item: item } ] });
    });

    this.topscreen = this.app.createNewScreenObject('loginapp','frame',$todd.componentsToMessages(screencomponents));

    handlers.forEach(item =>
    {
      this.topscreen.setMessageHandler(item.component, item.msgtype, item.handler);
    });
  }

  handleSubmitInstruction(result, callback)
  {
    if (result.submitinstruction.type == "reload")
    {
      //no need to execute the submit instruction, it just redirects back to the shell..
      this.app.terminateApplication();
      $shell.wrdauth.refresh();
      $shell.wrdauth.setupPage();
      $shell.executeShell();
      callback();
    }
    else
    {
      whintegration.executeSubmitInstruction(result.submitinstruction);
      return;
    }

  }

  async executePasswordLogin(data,callback)
  {
    let loginname = this.topscreen.getComponent('loginname').getSubmitValue();
    let password = this.topscreen.getComponent('password').getSubmitValue();
    let savelogin = this.topscreen.getComponent('savelogin').getSubmitValue().value;

    if(!loginname || !password)
    {
      let errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.enterusernameandpassword"), buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
      callback();
      return await errorscreen;
    }

    try
    {
      let result = await $shell.wrdauth.login(loginname,password, { persistent: savelogin });
      if (result.submitinstruction)
      {
        this.handleSubmitInstruction(result, callback);
        return;
      }
      if (result.code === "REQUIRESECONDFACTOR")
      {
        let selecttab = this.topscreen.getComponent('secondfactor');
        this.topscreen.getComponent('tabs').setSelected(selecttab.name, true);
        this.topscreen.getComponent('frame').setFocusTo('totpcode');

        this.secondfactordata = result.secondfactordata;
        this._updateSecondFactorText();
        callback();
        return;
      }
      if (result.code == "REQUIRESETUPSECONDFACTOR")
      {
        this.topscreen.getComponent('password').setValue("");
        let app = $shell.startBackendApplication("system:managetwofactorauth", null,
            { onappbar:false
            , isloginapp: true
            , message: { setuplink: result.setuplink }
            });

        await app.getLoadPromise();
        callback();
        return;
      }
      if (result.code == "FAILEDVALIDATIONCHECKS")
      {
        this.topscreen.getComponent('password').setValue("");
        let app = $shell.startBackendApplication("system:resetpassword", null,
            { onappbar:false
            , isloginapp: true
            , message: { passwordresetlink: result.passwordresetlink }
            });

        await app.getLoadPromise();
        callback();
        return;
      }

      let text = result.code == "LOGINCLOSED" ? getTid("tollium:shell.login.closedlogin")
                 : result.code == "DISABLED" ? getTid("tollium:shell.login.disabledlogin")
                 : getTid("tollium:shell.login.invalidlogin");
      let errorscreen = runSimpleScreen(this.app, { text: text, buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
      callback();
      callback = null;
      return await errorscreen;
    }
    catch(error)
    {
      if (callback)
        callback();
      this.app.showExceptionDialog(error);
    }
  }

  async executeForgot(data,callback)
  {
    let app = $shell.startBackendApplication("system:forgotpassword", this.app);
    await app.getLoadPromise();
    callback();
  }

  async executeSAMLLogin(item, data, callback)
  {
    try
    {
      let result = await $shell.wrdauth.startLogin(item.type, item.tag, { action: 'redirect', allowlogout: item.allowlogout });
      whintegration.executeSubmitInstruction(result);
      return;
    }
    catch(error)
    {
      callback();
      this.app.showExceptionDialog(error);
    }
  }

  handlePassiveSAMLLogin(instr)
  {
    // Create off-screen iframe
    var iframe = dompack.create("iframe",
          { style:
                { position: "absolute"
                , left: "-40px"
                , top: "-40px"
                , width: "10px"
                , height: "10px"
                , zIndex: "-1"
                }
          });

    // Execute the submitinstruction in the iframe
    document.body.appendChild(iframe);
    whintegration.executeSubmitInstruction(instr, { iframe: iframe });

    // The SP will send us a message with the login result
    window.addEventListener("message", e =>
    {
      var data = JSON.parse(e.data);
      console.log(data, instr, instr.requestid);
      if (data && data.id == instr.requestid)
      {
        if (data.status == "loggedin")
        {
          // not logged in into shell, so reload won't trigger unload warning
          location.reload();
        }
      }
    });
  }

  executeCancelSecondFactorLogin(data,callback)
  {
    let selecttab = this.topscreen.getComponent('body');
    this.topscreen.getComponent('tabs').setSelected(selecttab.name, true);

    this.secondfactordata = null;
    callback();
  }

  async executeSecondFactorLogin(data,callback)
  {
    const code = this.topscreen.getComponent('totpcode').getSubmitValue();
    const persistent = this.topscreen.getComponent('savelogin').getSubmitValue().value;

    const result = await $shell.wrdauth.loginSecondFactor(this.secondfactordata.firstfactorproof, "totp", { code }, { persistent });
    if (result.submitinstruction)
    {
      this.handleSubmitInstruction(result, callback);
      return;
    }

    switch (result.code)
    {
      case "INVALIDDATA":
      {
        this.secondfactordata = null;

        let errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.invaliddata"), buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
        callback();
        await errorscreen;

        // reload to login again
        location.reload();
      } break;

      case "TOTPLOCKED":
      {
        let errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totplocked"), buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
        callback();
        await errorscreen;
        this.secondfactordata = result.secondfactordata;
      } break;

      case "TOTPINVALIDCODE":
      {
        let errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totpinvalidcode"), buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
        callback();
        await errorscreen;
        this.secondfactordata = result.secondfactordata;
      } break;

      case "TOTPREUSEDCODE":
      {
        let errorscreen = runSimpleScreen(this.app, { text: getTid("tollium:shell.login.totpreusedcode"), buttons: [{ name: 'ok', title: getTid("tollium:common.actions.ok") }] });
        callback();
        await errorscreen;
        this.secondfactordata = result.secondfactordata;
      } break;
    }

    this._updateSecondFactorText();
  }

  _updateSecondFactorText()
  {
    if (this.secondfactordata)
    {
      switch (this.secondfactordata.totpattemptsleft)
      {
        case 6:
        {
          this.topscreen.getComponent("secondfactorattemptsleft").setValue(getTid("tollium:shell.login.enterauthenticatorcode"));
        } break;
        case 0:
        {
          this.topscreen.getComponent("secondfactorattemptsleft").setValue(getTid("tollium:shell.login.enterbackupcode"));
        } break;
        default:
        {
          this.topscreen.getComponent("secondfactorattemptsleft").setValue(getTid("tollium:shell.login.totpattemptsleft", this.secondfactordata.totpattemptsleft.toString()));
        }
      }
    }
  }
}

registerJSApp('tollium:builtin.login', LoginApp);
