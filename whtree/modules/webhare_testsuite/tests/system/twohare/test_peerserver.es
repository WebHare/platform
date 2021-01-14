// Note: you need two webhares to run this test. See twoharetests.sh

import * as test from "@mod-tollium/js/testframework";
import * as dompack from "dompack";

let setupdata, setup2data;

test.registerTests(
  [ async function()
    {
      let setup1 = test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup'
                                       , { createsysop: true
                                         , prepmodule: true
                                         });

      //this removes the testsuite module on the second server
      let setup2 = test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup'
                                       , { onpeerserver:true
                                         });
      setupdata = await setup1;
      setup2data = await setup2;
      await test.load(test.getWrdLogoutUrl(setupdata.testportalurl + "?app=system:config&notifications=0"));
      await test.wait("ui");

      // Wait for login page to appear
      await test.wait(200);
      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');
      await test.wait('ui');
    }

  , "Setup peering"
  , async function()
    {
      test.focus(test.compByName("modules"));
      //ugly way to find our module, but the alternative is scrolling the list on busy servers
      await test.pressKey('webhare_testsuite_temp'.split(''));

      test.clickToddToolbarButton("Connect");
      await test.wait("ui");
      test.clickToddButton("Add");
      await test.wait("ui");
      test.setTodd('peer', setupdata.peerserver);

      let oauth_auth_wait = dompack.createDeferred();
      test.getWin().open = async url =>
      {
        let overlay = test.getDoc().createElement("div");
        window.parent.overlay = overlay;
        overlay.innerHTML =
          `<div style="position:fixed; top: 20px; left:20px; width:800px; height:640px;">
             <iframe src="${url}" style="width:800px;height:640px;border:none;display:block"></iframe>
           </div>`;
        test.getDoc().body.appendChild(overlay);

        while(true)
        {
          if(!test.compByName("peer"))
            break; //dialog is gone so peering must have completed

          /* get the peering code to progress:
             the second webhare has been configured with the feature webhare_testsuite:insecure_interface on its backend
             which disables some security and loads remotecontrol.js which will do the actual login for us when postMessage
             as there's no way to directly control the iframe of course */
          overlay.querySelector("iframe").contentWindow.postMessage(
             { dopeering: { overridetoken: new URL(setup2data.overridetoken,location.href).searchParams.get("overridetoken")
                          }
             },"*");

          await test.wait(100);
        }

        test.getDoc().body.removeChild(overlay);
        oauth_auth_wait.resolve();
      };

      test.clickToddButton("Connect");
      await oauth_auth_wait.promise;

      test.clickToddButton("Connect");
      await test.wait("ui");

      await test.wait(300); //the test.focus below wasn't enough, for some reason focus doesn't get set. workaround that race..

      test.focus(test.compByName("modules")); //TODO should this really be necesassry?
      test.clickToddToolbarButton("Deploy module");
      await test.wait("ui");

      test.clickToddButton("Yes"); //first push
      await test.wait("ui");
      test.clickToddButton("OK");
    }

  ]);
