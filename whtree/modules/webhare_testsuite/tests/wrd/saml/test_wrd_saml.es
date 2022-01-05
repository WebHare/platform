import * as test from '@mod-tollium/js/testframework';

var webroot = test.getTestSiteRoot();

var overridetoken = "";

test.registerTests(
  [ { name: "Test setup"
    , test: async function()
      {
        overridetoken = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupSAML', test.getTestArgument(0));
        overridetoken = overridetoken.split("overridetoken=")[1];
      }
    }

  , { name: "Configure IDP - open SAMLauth for domain"
    , loadpage: function() { return webroot + 'test-saml/portal-idp/?overridetoken=' + overridetoken + "&notifications=0&app=wrd(webhare_testsuite:saml-idp)/samlauth&language=en"; }
    , waits: [ "ui" ]
    }
  , { name: "Configure IDP - open SAMLauth for domain"
    , test: function(doc, win)
      {
        test.sendMouseGesture([{el:test.getCurrentScreen().getListRow('samlproviders!entities','IDP'), down:2},{up:2} ]);
        var ctxtmenu = test.getOpenMenu();
        var menuitem = test.qSA(ctxtmenu,"li").filter(li=>li.textContent.includes('Add connected SP'))[0];
        test.click(menuitem);
      }
    , waits: [ "ui" ]
    }
  , { name: "Configure IDP - Import SP metadata"
    , test: function(doc, win)
      {
        const metadataurl = new URL(webroot + "test-saml/portal-sp/saml-sp-test-sp", location.href).toString();
        test.getCurrentScreen().getToddElement("metadataurl").querySelector("input").value = metadataurl;
        test.clickToddButton("Update metadata");
      }
    , waits: [ "ui" ]
    }
  , { name: "Configure IDP - Confirm imported SP"
    , test: function(doc, win)
      {
        test.eq("http://webhare.net/webhare_testsuite/test-saml/saml/sp", test.getCurrentScreen().getToddElement("samlentityid").querySelector("input").value);
        test.clickToddButton("OK");
      }
    , waits: [ "ui" ]
    }

  , { name: "Configure SP - open SAMLauth for domain"
    , loadpage: function() { return webroot + 'test-saml/portal-idp/?overridetoken=' + overridetoken + "&notifications=0&app=wrd(webhare_testsuite:saml-sp)/samlauth&language=en"; }
    , waits: [ "ui" ]
    }
  , { name: "Configure SP - open SAMLauth for domain"
    , test: function(doc, win)
      {
        test.sendMouseGesture([{el:test.getCurrentScreen().getListRow('samlproviders!entities','TEST-SP'), down:2},{up:2} ]);
        var ctxtmenu = test.getOpenMenu();
        var menuitem = test.qSA(ctxtmenu,"li").filter(li=>li.textContent.includes('Add connected IDP'))[0];
        test.click(menuitem);
      }
    , waits: [ "ui" ]
    }
  , { name: "Configure SP - Import IDP metadata"
    , test: function(doc, win)
      {
        const metadataurl = webroot + "test-saml/portal-idp/saml-idp";
        test.getCurrentScreen().getToddElement("metadataurl").querySelector("input").value = metadataurl;
        test.clickToddButton("Update metadata");
      }
    , waits: [ "ui" ]
    }
  , { name: "Configure SP - Confirm imported IDP"
    , test: function(doc, win)
      {
        test.eq("http://webhare.net/webhare_testsuite/test-saml/saml/idp", test.getCurrentScreen().getToddElement("samlentityid").querySelector("input").value);
        test.clickToddButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: "Verify adding worked"
    , test: function(doc, win)
      {
        let el = test.getCurrentScreen().getListRow('samlproviders!entities','SP');
        test.true(el, 'the row with the SP should be in the list');
      }
    }

  , { name: "open sp-enabled portal"
    , loadpage: webroot + 'test-saml/portal-sp&language=en'
    , waits: [ "ui", 'ui' ]
    }

  , { name: "goto idp"
    , test: function(doc, win)
      {
        let image = test.getCurrentScreen().getToddElement("image_test-sp");
        test.click(image);
        //test.click(test.getCurrentScreen().getToddElement("image_test-sp").querySelector("img"), { x: 5, y: 5 });
      }
    , waits: [ "pageload", "ui" ]
    }

  , { name: "login with idp account"
    , test: function(doc, win)
      {
        test.setTodd('loginname', 'idpaccount@allow2fa.test.webhare.net');
        test.setTodd('password', 'a');
        test.clickToddButton('Login');
        // Expect rpc, X form posts to sp (ADDME how many?), sp tollium load
      }
    , waits: [ 'pageload', 'ui' ]
    }
  , { name: "test logged in into portal-sp with idp account"
    , test: function(doc, win)
      {
        test.true(win.location.href.match(/portal-sp/));
        test.eq("idpaccount@allow2fa.test.webhare.net", test.qS("#dashboard-user-name").textContent);

        // Logout must be allowed, and then logout
        test.true(test.qS("#dashboard-logout").classList.contains("dashboard-logout--allowed"));
        test.click(test.qS("#dashboard-logout"));
      }
    , waits: [ "ui" ]
    }
  , { name: "confirm logout in sp"
    , test: function(doc, win)
      {
        test.clickToddButton("Yes");
      }
    , waits: [ "ui", "pageload" ]
    }

  , { name: "open sp-enabled nologout portal"
    , loadpage: webroot + 'test-saml/portal-sp/portal-sp-nologout&language=en'
    , waits: [ "ui" ]
    }

  , { name: "goto idp"
    , test: function(doc, win)
      {
        test.click(test.getCurrentScreen().getToddElement("image_test-sp"));
      }
    , waits: [ "pageload", "ui" ]
    }

    // Already logged into idp, so we'll get back immediately

  , { name: "test logged in into portal-sp with idp account"
    , test: function(doc, win)
      {
        test.true(win.location.href.match(/portal-sp/));
        test.eq("idpaccount@allow2fa.test.webhare.net", test.qS("#dashboard-user-name").textContent);

        // Logout must be allowed, and then logout
        test.false(test.qS("#dashboard-logout").classList.contains("dashboard-logout--allowed"));
      }
    }

    // UT CampusApp login requires that a portal honors the wrdauth_logincontrol variable
  , { name: "test wrdauth_returnto functions on login page"
    , test: async function(doc, win)
      {
        let returnurl = webroot + 'test-saml/portal-sp/';
        let { logincontrol } = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildLoginRedirectToken', webroot + 'test-saml/portal-idp/', returnurl);
        await test.load(webroot + 'test-saml/portal-idp/?wrdauth_logincontrol=' + encodeURIComponent(logincontrol));

        // test redirect worked
        test.true(/test-saml\/portal-sp/.exec(win.location.href), "Should have redirected to portal-sp site");
      }
    }

  , "IdP initiated login"
  , async function()
    {
      await test.load(`${webroot}test-saml/portal-idp/?overridetoken=${overridetoken}&notifications=0&app=wrd(webhare_testsuite:saml-idp)/samlauth/samlproviders=[0]/connectedproviders=[0]&language=en`);
      await test.wait('ui');
      let newwin = await test.expectWindowOpen(() => test.clickToddButton('Login'));
      test.eq("submitinstruction", newwin.type);
      test.eq("redirect", newwin.instr.type);
      await test.load(newwin.instr.url);

      // should redirect to the root of the testsuite site
      test.eq("Basetest title", test.qS("#basetitle").textContent);
      test.eq("/WebHare testsuite site/index.rtd", test.qS("#whfspath").textContent);
    }
  ]
);
