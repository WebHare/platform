import * as test from '@mod-tollium/js/testframework';

var setupdata;

function getTowlNotifications()
{
  return test.qSA('t-towlnotification').filter(node => !node.textContent.includes("gonativetitle")); //filter native notification notification
}

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'SetupForTestSetup', { createsysop:true });

      await test.load(`${test.getTestSiteRoot()}portal1/${setupdata.overridetoken}?app=webhare_testsuite:runscreen(${'tests/comm.eventserver'})&notifications=browser&checkinterval=0`);
      await test.wait('ui');
    }
  , { name: 'send event'
    , test: async function(doc,win)
      {
        test.eq(0, test.qSA('t-towlnotification').length);
        test.click(test.getMenu(['A01']));
        await test.wait("ui");
      }
    , waits: [ (doc,win) => { return getTowlNotifications().length > 0; } ]
    }

  , "Check second event"
  , async function()
    {
      //TODO what if you've enabled native notifications? perhaps a wh-debug=tollium-nonativenotification flag
      let notes = getTowlNotifications();
      test.eq(1, notes.length); //one for the note itself and one to suggest enabling native notifications
      test.eq('Eventserver test message', notes[0].querySelector('.title').textContent);
      test.eq('Message count: 1', notes[0].querySelector('.description').textContent);

      test.click(test.getMenu(['A01']));
      await test.wait( () => getTowlNotifications().length > 1);

      notes = getTowlNotifications();
      test.eq(2,notes.length);
      test.eq('Message count: 2', notes[1].querySelector('.description').textContent);
    }

  , "Check third event - should REPLACE second event"
  , async function()
    {
      test.click(test.getMenu(['A01']));
      await test.wait( () => getTowlNotifications()[1].querySelector('.description').textContent == 'Message count: 3'
                             || getTowlNotifications().length > 2);

      test.eq(2,getTowlNotifications().length);
    }

  , async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib', 'SetupForTestSetup', { createsysop:true });

      await test.load(`${test.getTestSiteRoot()}portal1/${setupdata.overridetoken}?app=webhare_testsuite:runscreen(${'tests/comm.eventserver'})&notifications=browser&checkinterval=0`);
      await test.wait('ui');
      await test.wait(3000);//wait 3 secs for any notes to appear.. there's no safe duration
    }
  , { name: 'no duplicate events form last test?'
    , test:function(doc,win)
      {
        test.eq(0,getTowlNotifications().length);
        test.click(test.getMenu(['A01']));
      }
    , waits: [ (doc,win) => { return getTowlNotifications().length > 0; } ]
    }
  , { test: function(doc,win)
      {
        let notes = getTowlNotifications();
        test.eq(1,notes.length);
      }
    }
  ]);
