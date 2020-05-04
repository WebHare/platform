import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

let setupdata;

test.registerTests(
  [ { test: async function()
      {
        setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'SetupForTestSetup'
                                         , { createsysop: true
                                           , preprtd: true
                                           });
      }
    }
  , { loadpage:function()
      {
        return test.getWrdLogoutUrl(setupdata.testportalurl + "?app=publisher(" + setupdata.rtdid + ")");
      } //we don't feel like navigating the start menu
    }
  , { test: async function()
      {
        // Wait for login page to appear
        await test.wait(200);
        test.setTodd('loginname', setupdata.sysopuser);
        test.setTodd('password', setupdata.sysoppassword);
        test.clickToddButton('Login');
        await test.wait("ui");
      }
    }
  , { test: async function()
      {
        test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
        test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
      }
    , waits: ['ui', 2000] //login currently refreshes
    }
  , { test: async function()
      {
        let h1 = test.getCurrentScreen().qSA('h1.heading1');
        test.eq(1,h1.length);
        //ADDME css ready would be nice, but we'll just wait 2sec
        test.eq('rgb(0, 0, 255)', getComputedStyle(h1[0]).color);
      }
    }

  ]);
