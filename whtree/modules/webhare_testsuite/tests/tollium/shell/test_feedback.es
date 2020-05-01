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

      await test.wait('ui');
    }
  , "Start feedback app, check if we can control feedback"
  , async function()
    {
      await test.load(setupdata.testportalurl + "?app=publisher:feedback");
      await test.wait('ui');

      let selectscope = test.compByName("scope");
      if(selectscope) //the scope pulldown only appears when we have a choice
      {
        let toselect = test.qSA(selectscope,"option").filter(opt=>opt.textContent == "tollium:webharebackend")[0];
        test.fill(selectscope,toselect.value);
        await test.wait("ui");
      }

      test.click(test.qSA('t-toolbar t-button').slice(-1)[0]);
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
      await test.wait('ui');
      test.clickToddButton('OK');
    }
  , "Check if we got the issue"
  , async function()
    {
      let feedbackrows = await test.waitForToddComponent('feedback!entities');
      test.click(test.qSA(feedbackrows,'div.listrow')[0]);
      await test.wait('ui'); //list apparently needs this time to process the selection update
      test.clickToddToolbarButton("View");
    }
  ]);
