import test from "@mod-system/js/wh/testframework";

let testinfo;

test.registerTests(
  [ "setup"
  , async function()
    {
      // Setup the test site and load the test page
      testinfo = await test.invoke("mod::webhare_testsuite/tests/publisher/contentlibraries/libs/adaptivecontent.whlib#SetupDCTest");
      await test.load(testinfo.url + "?wh-debug=bac");

      // Clear all beacons and reload
      test.click("#resetallbeacons");
      test.click("#resetvisitcount");
      await test.wait(() => test.qSA("#currentbeacons div").length == 0);
      await test.wait(() => test.qS("#visitcount").dataset.visitCount == "0");
      await test.load(testinfo.url + "?wh-debug=bac");

      // We were supposed to arrive at this page without any beacons, and so we should see Widget 1.C
      // Look in the datalayer for direct verification
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot" && _.whContentSelected == "widget-1c"));
      test.eq(1, test.qSA("#slot1holder .accontent-widget--content").length); //should be one of those
      test.eq("Widget 1.C", test.qSA("#slot1holder .accontent-widget--content")[0].textContent.trim()); //should be one of those
      test.eq(1, test.qSA("#slot1holder .accontent-widget-trailer").length); //should also be cloned
      // The content widget beacon should not have been triggered (wait a bit as beacons aren't triggered immediately)
      await test.sleep(100);
      test.false(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "content-widget-shown"));

      // This is the first visit, show Widget 2.A
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot-2" && _.whContentSelected == "widget-2a"));
      test.eq("Widget 2.A", test.qSA("#slot2holder .accontent-widget--content")[0].textContent.trim());

      // Check if both widgets were registered, order isn't guaranteed though
      const trailers =
        [ test.qSA("#slot1holder .accontent-widget-trailer")[0].textContent.trim()
        , test.qSA("#slot2holder .accontent-widget-trailer")[0].textContent.trim()
        ];
      test.true(trailers.includes('Trailer! 1 widget(s) in DOM'));
      test.true(trailers.includes('Trailer! 2 widget(s) in DOM'));
    }

  , "beacons"
  , async function()
    {
      // Set and reset the student beacon
      test.true(test.getWin().dataLayer);
      test.click("#setstudentbeacon");
      await test.wait(() => test.qSA("#currentbeacons div").length == 1);
      test.true(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "is-student"));
      test.click("#clearstudentbeacon");
      await test.wait(() => test.qSA("#currentbeacons div").length == 1);
      test.true(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:clear-user-beacon' && _.whUserBeacon == "is-student"));

      // Load the beacon document, which should set the employee beacon
      await test.load(testinfo.beacondoc + "/?wh-debug=bac");

      test.true(test.getWin().dataLayer);
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "is-employee"));
    }

  , "adaptivecontent"
  , async function()
    {
      // Load the testpage again
      await test.load(testinfo.url + "?wh-debug=bac");

      // The employee beacon should be set now
      await test.wait(() => test.qSA("#currentbeacons div").length == 1);

      // With the beacon active, we should now get Widget 1.A
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot" && _.whContentSelected == "widget-1a"));
      test.eq(1, test.qSA("#slot1holder .accontent-widget--content").length); //should be one of those
      test.eq("Widget 1.A", test.qSA("#slot1holder .accontent-widget--content")[0].textContent.trim()); //should be one of those
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot-2" && _.whContentSelected == "widget-2a"));
      test.true(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot-2" && _.whContentSelected == "widget-2a"));
      // The content widget beacon should not have been triggered (wait a bit as beacons aren't triggered immediately)
      await test.sleep(100);
      test.false(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "content-widget-shown"));

      // This is still the first visit (session hasn't changed yet)
      test.eq("Widget 2.A", test.qSA("#slot2holder .accontent-widget--content")[0].textContent.trim());

      // Refresh with the reference date set to one week in the future, we should now get Widget 1.B
      let date = new Date();
      date.setDate(date.getDate() + 7);
      await test.load(testinfo.url + "?now=" + date.toISOString() + "&wh-debug=bac");
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot" && _.whContentSelected == "widget-1b"));
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot-2" && _.whContentSelected == "widget-2a"));
      test.eq(1, test.qSA("#slot1holder .accontent-widget--content").length); //should be one of those
      test.eq("Widget 1.B", test.qSA("#slot1holder .accontent-widget--content")[0].textContent.trim()); //should be one of those
      // The content widget beacon should now trigger
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "content-widget-shown"));

      // Reset the session and reload, should trigger a new visit for the same visitor (widget 2.A no longer applies)
      test.click("#resetvisitsession");
      await test.load(testinfo.url + "?wh-debug=bac");
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "a-slot-2" && _.whContentSelected == "widget-2b"));
      test.eq("Widget 2.B", test.qSA("#slot2holder .accontent-widget--content")[0].textContent.trim());

      // Header slot is empty (the header widget is shown during January 2000)
      test.eq(0, test.qSA("#headerslotholder .accontent-widget--content").length);

      // Reload using 15 January 2000 as reference date
      await test.load(testinfo.url + "?now=2000-01-15T12:34:56&wh-debug=bac");
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:show-dynamic-content' && _.whContentSlot == "headerslot" && _.whContentSelected == "widget"));
      test.eq(1, test.qSA("#headerslotholder .accontent-widget--header").length);
      test.eq("Happy New Millennium!", test.qSA("#headerslotholder .accontent-widget--header")[0].textContent.trim());
    }

  , "form page beacons"
  , async function()
    {
      // The thank you page beacon hasn't been triggered yet
      test.false(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "form-thank-you-page"));

      // Load the form page
      await test.load(testinfo.beaconform + "?wh-debug=bac");

      // Wait for the employee beacon to be triggered
      test.true(test.getWin().dataLayer);
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "is-employee"));

      // The thank you page beacon still shoudn't have been triggered yet
      test.false(Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "form-thank-you-page"));

      // Submit the form
      test.click(test.qS("button[type=submit]"));

      // The thank you page beacon should now have been triggered
      await test.wait(() => Array.from(test.getWin().dataLayer).some(_ => _.event == 'wh:trigger-user-beacon' && _.whUserBeacon == "form-thank-you-page"));
    }
  ]);
