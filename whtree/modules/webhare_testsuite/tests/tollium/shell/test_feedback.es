import * as test from "@mod-tollium/js/testframework";

let setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'SetupForTestSetup'
                                       , { createsysop: true
                                         });
      await test.load(test.getWrdLogoutUrl(setupdata.testportalurl));
      await test.wait('ui');

      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');

      await test.wait('pageload'); //login refreshes
      await test.wait('ui');
    }
  , "Report an issue!"
  , async function()
    {
      test.click('.wh-tollium__feedback');
      await test.wait('ui');

      test.clickToddButton('Specific');
      await test.wait('ui');
      test.click('.t-apptab__icon');

      await test.wait(() => test.qSA(".t-apptab").length == 2); //wait for the feedback dialog to appear
      await test.wait('ui'); //a new app will spawn
      test.setTodd('remarks',`I've got an issue with this bunny`);
      test.clickToddButton('OK');
    }
  , "Start feedback app"
  , async function()
    {
      await test.load(setupdata.testportalurl + "?app=publisher:feedback");
      await test.wait('ui');

      test.click(test.qSA('div.listrow')[0]);
      await test.wait('ui'); //list apparently needs this time to process the selection update
      test.clickToddToolbarButton("View");
    }
  ]);
