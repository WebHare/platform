import * as test from "@mod-tollium/js/testframework";

let setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup'
                                       , { createsysop: true
                                         , preprtd: true
                                         });
      await test.load(test.getWrdLogoutUrl(setupdata.testportalurl + "?app=publisher(" + setupdata.rtdid + ")"));
      // Wait for login page to appear
      await test.wait('ui');
      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');
      await test.wait("ui");
    }
  , async function()
    {
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));
      test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'testapp-editrtd.rtd'));

      await test.wait('ui');
    }
  , async function()
    {
      let h1 = test.getCurrentScreen().qSA('h1.heading1');
      test.eq(1,h1.length);
      //ADDME css ready would be nice, but we'll just wait
      await test.wait( () => getComputedStyle(h1[0]).color == 'rgb(0, 0, 255)');
    }

  ]);
