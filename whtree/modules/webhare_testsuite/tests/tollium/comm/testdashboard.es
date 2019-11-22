import test from "@mod-tollium/js/testframework";

var setupdata;

test.registerTests(
  [ "Prepare"
  , async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'SetupForTestSetup'
                                       , { createsysop: true
                                         });
      await test.load(setupdata.testportalurl);
      await test.wait('ui');

      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');

      await test.wait('pageload');
      await test.wait('ui');
    }

  , "Test dashboard menu"
  , async function()
    {
      //test dashboard now at the end
      test.eq("TEST GROUP", test.qS(".dashboard__menuitem:last-of-type .dashboard__menusectiontitle").textContent);
      test.eq("Dashboard", test.qS(".dashboard__menuitem:last-of-type .dashboard__app:last-of-type .dashboard__apptitle").textContent);
    }
  ]);
