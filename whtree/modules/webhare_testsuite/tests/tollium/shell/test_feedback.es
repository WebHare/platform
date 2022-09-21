import * as test from "@mod-tollium/js/testframework";

let setupdata, feedbackid;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup'
                                       , { createsysop: true
                                         });
      await test.load(test.getWrdLogoutUrl(setupdata.testportalurl));
      await test.wait('ui');

      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');

      await test.wait('ui');
    }
  , "Start feedback app, check if we can control feedback"
  , async function()
    {
      await test.load(setupdata.testportalurl + "?app=publisher:feedback");
      await test.wait('ui');

      test.click(test.qSA('t-toolbar t-button').at(-1));
      test.click(test.qSA("ul.wh-menu li").filter(li => li.textContent == "Settings")[0]);
      await test.wait("ui");

      test.setTodd('enabletolliumfeedback',true);
      test.clickTolliumButton("OK");
      await test.wait("ui");

      //wait for feedback button to appear
      await test.wait( () => test.qS(".wh-tollium__feedback"));
    }
  , "Report an issue!"
  , async function()
    {
      test.click('.wh-tollium__feedback');
      await test.wait('ui');

      test.clickToddButton('Specific');
      await test.wait('ui');
      test.click(test.qSA('.t-apptab__icon')[0]);

      await test.waitForToddComponent('remarks');
      test.setTodd('remarks',`I've got an issue with this bunny`);
      test.clickToddButton('OK');
      // The message contains the generated feedback id
      const message = await test.waitForToddComponent("message");
      test.eqMatch(/id '[^']*'.$/, message.textContent);
      const idx = message.textContent.lastIndexOf("'", message.textContent.length - 3);
      feedbackid = message.textContent.substring(idx + 1, message.textContent.length - 2);
      test.clickToddButton('OK');
    }
  , "Check if we got the issue"
  , async function()
    {
      // Wait for a row to appear with the generated feedback id
      await test.wait(() => test.qSA(`div.listrow`).filter(row => row.querySelector(".list__row__cell")?.textContent == feedbackid).length);
      let feedbackrows = await test.waitForToddComponent('feedback');
      test.click(test.qSA(feedbackrows,'div.listrow')[0]);
      await test.wait('ui'); //list apparently needs this time to process the selection update
      test.clickToddToolbarButton("Properties");
    }
  ]);
