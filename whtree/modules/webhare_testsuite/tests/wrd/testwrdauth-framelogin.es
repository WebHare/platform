import * as test from '@mod-tollium/js/testframework';

var webroot = test.getTestSiteRoot();
var setupdata = null;
var receivedmessage;

async function tryProtectedURL(gotourl)
{
  //"Try direct access first"

  await test.load(gotourl);
  await test.wait('ui');
  test.true(test.getCurrentScreen().getToddElement("loginname"), "cannot find login field? did we log out?");

  // "Login"
  await test.load(webroot + 'portal1/?app=publisher(/WebHare%20testsuite%20site%20-%20alt%20host)');
  await test.wait('ui');

  test.setTodd('loginname', setupdata.sysopuser);
  test.setTodd('password', setupdata.sysoppassword);
  test.clickToddButton('Login');

  await test.wait('pageload');
  await test.wait('ui');

  test.getWin().addEventListener("message", e => receivedmessage = e.data);

  test.click(test.getCurrentScreen().getListRow('filelist!mylist', 'requirewhaccount.rtd'));

  await test.wait( () => receivedmessage && receivedmessage.type == "webhare_testsuite:requirewhaccount");
}

test.registerTests(
  [ "Test with protected subdir"
  , async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'SetupForTestSetup', { createsysop:true, requirealternatesite: true });
      await tryProtectedURL(setupdata.alternatesite + "requirewhaccount");
    }

  , "Now try with a protected ROOT"
  , async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'SetupForTestSetup', { createsysop:true, requirealternatesite: true, protectroot: true });
      await tryProtectedURL(setupdata.alternatesite);
    }
  ]);
