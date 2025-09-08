import * as test from "@mod-system/js/wh/testframework";
import * as pwatests from '@mod-publisher/js/pwa/tests';
import { throwError } from "@webhare/std";

test.runTests(
  [
    "cleanup",
    async function () {
      await pwatests.prepare('webhare_testsuite:pwatest');
    },

    "start app",
    async function () {
      //FOR DEBUGGING
      // setTimeout ( async () => console.table(await pwatests.getSWLog()), 1000);
      await test.load(test.getTestSiteRoot() + 'pwatest/');
      await test.wait(() => test.qS("#pwa-offline"));

      //doc is live now. verify the log, it should show one install + one active event
      console.log("lookup logs");
      const swlog = await pwatests.getSWLog();
      test.eq(1, swlog.filter(entry => entry.event === 'install').length);
    },

    "check for update",
    async function () {
      test.click('#checkforupdate');
      await test.wait(() => test.qR("#pwa-update-status").textContent !== 'Checking...');
      test.eq("we are uptodate", test.qR("#pwa-update-status").textContent);

      await pwatests.touchPage(); //to trigger a refresh

      test.click('#checkforupdate');
      await test.wait(() => test.qR("#pwa-update-status").textContent !== 'Checking...');
      test.eq("UPDATE AVAILABLE", test.qR("#pwa-update-status").textContent);
    },

    "apply update",
    async function () {
      const clock = test.qR("#pwa-published-at").textContent;

      console.log("RELOADING");
      await test.load(test.getTestSiteRoot() + 'pwatest/');
      await test.wait(() => test.qR("#pwa-offline"));
      test.eq(clock, test.qR("#pwa-published-at").textContent, "Shouldnt see the updated file yet, we're supposed to be offline - make sure 'Bypass for network' is not enabled in devtools>app>sw");

      test.click('#downloadupdate');
      await test.wait(() => test.qR("#pwa-update-status").textContent !== 'Downloading...');
      test.eq("DOWNLOAD COMPLETE", test.qR("#pwa-update-status").textContent);

      test.click('#updatenow');
      console.log("move clock from", clock);

      await test.wait("pageload");
      await test.wait(() => test.qS("#pwa-offline"));
      test.eq(false, clock === test.qR("#pwa-published-at").textContent);
    },

    "get image",
    async function () {
      const deferred = Promise.withResolvers();
      test.qR("#myimglink").onload = deferred.resolve;
      test.qR("#myimglink").src = test.qR("#myimglink").dataset.imglink ?? throwError("Missing imglink");
      await deferred.promise;

      const textfile = await test.getWin().fetch(test.qR("#mytextfilelink").dataset.textfilelink ?? throwError("Missing textfilelink"));
      test.eq("This is a public text file", (await textfile.text()).trim());
      // test.qS("#textfilelink").src = ;

      const cachemissses = (await pwatests.getSWLog()).filter(entry => entry.event === 'miss');
      test.eq([], cachemissses, "Fetches must not have caused miss-es in the log");
    },

    "test exclusion",
    async function () {
      let exclusionresult = await (await test.getWin().fetch("../exclusiontestpage/")).json();
      let exclusionresult2 = await (await test.getWin().fetch("../exclusiontestpage/")).json();
      test.assert(exclusionresult2.now !== exclusionresult.now, "Fetches must not have been cached #1");

      exclusionresult = await (await test.getWin().fetch("../exclusiontestpage/?test")).json();
      exclusionresult2 = await (await test.getWin().fetch("../exclusiontestpage/?test")).json();
      test.assert(exclusionresult2.now !== exclusionresult.now, "Parameters should not matter in exclusion list");
      test.assert(exclusionresult2.now !== exclusionresult.now, "Fetches must not have been cached #2");

      exclusionresult = await (await test.getWin().fetch("../exclusiontestpage/#test")).json();
      exclusionresult2 = await (await test.getWin().fetch("../exclusiontestpage/#test")).json();
      test.assert(exclusionresult2.now !== exclusionresult.now, "Hashes should not matter in exclusion list");
      test.assert(exclusionresult2.now !== exclusionresult.now, "Fetches must not have been cached #3");

      const cachemissses = (await pwatests.getSWLog()).filter(entry => entry.event === 'miss');
      test.eq([], cachemissses, "Fetches must not have caused miss-es in the log");
    },

    "test force refresh",
    async function () {
      const clock = test.qR("#pwa-published-at").textContent;

      await pwatests.forceRefresh(); //to trigger a refresh
      await test.load(test.getTestSiteRoot() + 'pwatest/');
      await test.wait('pageload');
      test.eq(false, clock === test.qR("#pwa-published-at").textContent);
      // await test.wait( () => test.qS("#pwa-published-at").textContent !== clock);
    },

    "check error handling",
    async function () {
      //Load one never pre-reported asset
      await test.getWin().fetch("https://beta.webhare.net/", { mode: 'no-cors' });

      const cachemissses = (await pwatests.getSWLog()).filter(entry => entry.event === 'miss');
      if (cachemissses.length > 1)
        console.table(cachemissses);
      test.eq(1, cachemissses.length);
      test.eq("https://beta.webhare.net/", cachemissses[0].url);
    }
  ]);
