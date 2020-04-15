import * as test from '@mod-tollium/js/testframework';

var webroot = test.getTestSiteRoot();

test.registerTests(
  [ {
      test:async function()
      {
        await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'SetupAccessRules')
      }
    }

    // Goto portal2. Expect a redirect through gologin portal1 from access rule.
  , { name: "open protected url"
    , loadpage: webroot + 'portal2/?wh-debug='
    , waits:['ui']
    }

  , { name: "access rule portal login" //this lands on /porta1l/
    , test:function(doc,win)
      {
        test.eqMatch(/.*\/portal1\/.*/, win.location.href);
        test.setTodd('loginname', "test-portal1@example.com");
        test.setTodd('password', "secret");
        test.clickToddButton('Login');
      }
    , waits: ['pageload','ui'] //this should redirect us to portal2.*importsetssion. wait for the UI to init
    }
  //, testFollowWRDAuthRedirect("Redirect to protected portal", ['ui'])

  , { name: "protected portal login"
    , test:function(doc,win)
      {
        test.setTodd('loginname', 'test-portal2@example.com');
        test.setTodd('password', "secret");
        test.clickToddButton('Login');
      }
    , waits: ['pageload', 'ui']
    }

  , { name: "check login result"
    , test:function(doc,win)
      {
        test.eq("test portal2", test.qS("#dashboard-user-name").textContent);
      }
    }

  , { name: "remove cookies for /portal2" // Leave portal1, so we are still logged in there
    , test: async function()
      {
        await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'logoutportal2path')
      }
    }

    // Goto portal2. Expect a redirect to portal1 from access rule protecting portal2
  , { name: "open protected url"
    , loadpage: webroot + 'portal2/?wh-debug='
    , waits:['ui']
    }
  /*, { name: 'redirect to login page'
    , loadpage: function(doc,win) { console.log("currentlocation", doc.location.href, doc.getElementById('redirectto')); return doc.getElementById('redirectto').href }
    }
  , { name: 'redirect to import'
    , loadpage: function(doc,win) { console.log("currentlocation", doc.location.href, doc.getElementById('redirectto')); return doc.getElementById('redirectto').href }
    }
  , { name: 'redirect to protected portal'
    , loadpage: function(doc,win) { console.log("currentlocation", doc.location.href, doc.getElementById('redirectto')); return doc.getElementById('redirectto').href }
    , waits: [ 'ui' ]
    }*/
  , { name: "protected portal login" //we should be on portal1 here!
    , test:function(doc,win)
      {
        test.eqMatch(/.*\/portal2\/.*/, win.location.href);
        test.setTodd('loginname', 'test-portal2@example.com');
        test.setTodd('password', "secret");
        test.clickToddButton('Login');
      }
    , waits: ['pageload', 'ui']
    }
  , { name: "check login result"
    , test:function(doc,win)
      {
        test.eq("test portal2", test.qS("#dashboard-user-name").textContent);
      }
    }

  , { name: "remove cookies for /portal2" // Leave portal1, so we are still logged in there
    , test: async function()
      {
        await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'logoutstaticlogin')
      }
    }

    // Goto staticprotected. Expect a redirect through gologin to staticlogin from access rule.
  , { name: "open protected url"
    , loadpage: webroot + 'staticprotected/?wh-debug='
    }
  //, testFollowWRDAuthRedirect("redirect through gologin")
  //, testFollowWRDAuthRedirect("redirect to login page #2")
  , { name: "access rule portal login #2"
    , test:function(doc,win)
      {
        test.qS("#login").value = "test-portal1@example.com";
        test.qS("#password").value = "secret";
        test.click('input[type=submit]');
      }
    , waits: [ "pageload" ]
    //, waits: [ "ui", "pageload" ]
    }
  //, testFollowWRDAuthRedirect("redirect to protected page #2") //sets window.wrdauth_lastredirectsource
  , { name: 'protected page location test'
    , test:function(doc,win)
      {
        test.true(win.location.href.match(/staticprotected/));
        test.true(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    }
/*  , { name: 'test variable clear' //the authentication rules have gotten out of the way, so see if URLs are still fixed
    , loadpage: function(doc,win)
      {
        console.log("Restarting flow at ",window.wrdauth_lastredirectsource);
        return window.wrdauth_lastredirectsource;
      }
    }
  , { name: 'protected page location varclear test'
    , test:function(doc,win)
      {
        test.true(win.location.href.match(/staticprotected/));
        test.true(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    }*/
  , { name: "reset my session for staticprotected"
    , test: async function()
      {
        await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'staticprotectedresetsession')
      }
    }

  , { name: "open protected url after session reset"
    , loadpage: webroot + 'staticprotected/?wh-debug=aut'
    }
  , { test:function(doc,win)
      {
        test.true(win.location.href.match(/staticprotected/));
        test.true(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    }

  , { name: "remove cookies for staticlogin page"
    , test: async function()
      {
        await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'logoutstaticlogin')
      }
    }

    // Goto portal2. Expect a redirect to staticlogin from access rule, with external users
  , { name: "open protected url"
    , loadpage: webroot + 'staticprotected2/?wh-debug=aut'
    }
  //, testFollowWRDAuthRedirect('redirect to login page #3')

  , { name: "access rule portal login - fail"
    , test:function(doc,win)
      {
        test.fill(test.qS("#login"), "external");
        test.fill(test.qS("#password"), "b");
        test.click('input[type=submit]');
      }
    , waits: [ "ui" ]
    }
  , { name: "access rule portal login - ok"
    , test:function(doc,win)
      {
        var elts = test.qSA("#loginresult.loginfailed");
        test.eq(1, elts.length);

        test.fill(test.qS("#login"), "external");
        test.fill(test.qS("#password"), "secret");
        test.click('input[type=submit]');
      }
    , waits: [ "pageload" ]
    }
    // redirect to import is done directly in JS, no redirect page
  //, testFollowWRDAuthRedirect('redirect to protected page')
  , { name: 'protected page location test'
    , test:function(doc,win)
      {
        test.true(win.location.href.match(/staticprotected2/));
        test.true(/THE PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    }

  ]
);
