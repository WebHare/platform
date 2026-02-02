import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';

let setupdata: TestSetupData | null = null;

function getTowlNotifications() {
  return test.qSA('t-towlnotification').filter(node => !node.textContent?.includes("gonativetitle")); //filter native notification notification
}

test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });

      await test.load(`${test.getTestSiteRoot()}portal1/${setupdata.overridetoken}?app=webhare_testsuite:runscreen(${'tests/comm.eventserver'})&notifications=browser&checkinterval=0`);
      await test.waitForUI();
    },
    {
      name: 'send event',
      test: async function () {
        test.eq(0, test.qSA('t-towlnotification').length);
        test.click(test.getMenu(['A01']));
        await test.wait("ui");
      },
      waits: [() => { return getTowlNotifications().length > 0; }]
    },

    "Check second event",
    async function () {
      //TODO what if you've enabled native notifications? perhaps a wh-debug=tollium-nonativenotification flag
      let notes = getTowlNotifications();
      test.eq(1, notes.length); //one for the note itself and one to suggest enabling native notifications
      test.eq('Eventserver test message', notes[0].querySelector('.title')?.textContent);
      test.eq('Message count: 1', notes[0].querySelector('.description')?.textContent);

      test.click(test.getMenu(['A01']));
      await test.waitUIFree(); //absorb the modality layer triggered by server side event
      await test.wait(() => getTowlNotifications().length > 1);

      notes = getTowlNotifications();
      test.eq(2, notes.length);
      test.eq('Message count: 2', notes[1].querySelector('.description')?.textContent);
    },

    "Check third event - should REPLACE second event",
    async function () {
      test.click(test.getMenu(['A01']));
      await test.waitUIFree(); //absorb the modality layer triggered by server side event
      await test.wait(() => getTowlNotifications()[1].querySelector('.description')?.textContent === 'Message count: 3'
        || getTowlNotifications().length > 2);

      test.eq(2, getTowlNotifications().length);
    },

    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });

      await test.load(`${test.getTestSiteRoot()}portal1/${setupdata.overridetoken}?app=webhare_testsuite:runscreen(${'tests/comm.eventserver'})&notifications=browser&checkinterval=0`);
      await test.waitForUI();
      await test.sleep(3000);//wait 3 secs for any notes to appear.. there's no safe duration
    },
    {
      name: 'no duplicate events form last test?',
      test: function () {
        test.eq(0, getTowlNotifications().length);
        test.click(test.getMenu(['A01']));
      },
      waits: [() => { return getTowlNotifications().length > 0; }]
    },
    {
      test: function () {
        const notes = getTowlNotifications();
        test.eq(1, notes.length);
      }
    }
  ]);
