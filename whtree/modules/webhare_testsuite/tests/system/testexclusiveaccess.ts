import * as test from "@webhare/test-frontend";

test.runTests(
  [
    async function () {
      await test.updateFrame("main", { width: 400 });
      await test.addFrame("second", { width: 400 });
      await test.load(test.getTestSiteRoot() + "TestPages/exclusiveaccesstest/#2,piet");
      await test.addFrame("third", { width: 400 });
      await test.load(test.getTestSiteRoot() + "TestPages/exclusiveaccesstest/#3,teun");
      await test.addFrame("fourth", { width: 400 });
      await test.load(test.getTestSiteRoot() + "TestPages/exclusiveaccesstest/#3,teun");
      await test.selectFrame("main");
      await test.load(test.getTestSiteRoot() + "TestPages/exclusiveaccesstest/#1,hans");
    },
    "test exclusive access",
    async function () {
      // story: normal locking
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.click("#releaselock");
      await test.wait(() => test.qR("#status").textContent === "Lock not taken");

      // story: 2 locks, request takeover, deny
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");

      await test.selectFrame("second");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");

      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");
      test.eq(/after [0-9]+ seconds/i, test.qR(".mydialog").textContent);

      await test.selectFrame("main");
      await test.wait(() => test.qR("#status").textContent === "ReleaseRequest");
      console.error(test.qR(".mydialog").textContent);
      test.eq(/after [0-9]+ seconds/i, test.qR(".mydialog").textContent);

      test.click(`*[data-messagebox-result=no]`);
      test.eq(null, test.qS(".mydialog"), "Dialog should disappear");

      await test.selectFrame("second");
      await test.wait(() => test.qR("#status").textContent === "Failed getting the lock");
      test.eq(/has been denied/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=close]`);

      await test.selectFrame("main");
      test.click("#releaselock");
      await test.wait(() => test.qR("#status").textContent === "Lock not taken");

      // story: 2 locks, request takeover, allow
      await test.selectFrame("main");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);

      await test.selectFrame("second");
      test.eq("no", test.qR("#locked").textContent);
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");

      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");
      test.eq(/after [0-9]+ seconds/i, test.qR(".mydialog").textContent);

      await test.selectFrame("main");
      await test.wait(() => test.qR("#status").textContent === "ReleaseRequest");
      test.eq(/after [0-9]+ seconds/i, test.qR(".mydialog").textContent);

      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "LockStolen");
      test.eq("no", test.qR("#locked").textContent);
      test.eq(/taken over this/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=close]`);
      await test.wait(() => test.qR("#status").textContent === "LockStolenShown");

      await test.selectFrame("second");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);
      test.click("#releaselock");
      await test.wait(() => test.qR("#status").textContent === "Lock not taken");

      // story: 3 locks
      await test.selectFrame("main");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);

      await test.selectFrame("second");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");

      await test.selectFrame("third");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");

      await test.selectFrame("main");
      test.click("#releaselock");

      // frame 'second' should get the lock
      await test.selectFrame("second");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);

      // third should have updated the dialog
      await test.selectFrame("third");
      await test.wait(() => /piet testuser \(piet@/.exec(test.qR(".mydialog").textContent || ""));
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");

      await test.selectFrame("main");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");

      await test.selectFrame("second");
      await test.wait(() => test.qR("#status").textContent === "ReleaseRequest");
      test.eq("yes", test.qR("#locked").textContent);
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "LockStolen");
      test.eq(/has taken over/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=close]`);

      // first waiter in line (third) gets the lock
      await test.selectFrame("third");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);

      // main is denied the lock
      await test.selectFrame("main");
      await test.wait(() => test.qR("#status").textContent === "Failed getting the lock");
      test.eq("no", test.qR("#locked").textContent);
      test.eq(/has been denied/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=close]`);

      // STORY: take the lock from same entityid - no waiting for permission
      await test.selectFrame("fourth");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");
      test.eq(/another browser tab/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.click("#releaselock");

      await test.selectFrame("third");
      await test.wait(() => test.qR("#status").textContent === "LockStolen");
      test.eq(/has taken over/, test.qR(".mydialog").textContent);
      test.click(`*[data-messagebox-result=close]`);

      // story: cancel takeover request
      await test.selectFrame("main");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");

      await test.selectFrame("second");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");
      await test.selectFrame("main");
      await test.wait(() => test.qR("#status").textContent === "ReleaseRequest");
      await test.wait(() => /piet testuser \(piet@/.exec(test.qR(".mydialog").textContent || ""));

      await test.selectFrame("third");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "AlreadyLocked");
      test.click(`*[data-messagebox-result=yes]`);
      await test.wait(() => test.qR("#status").textContent === "WaitingForOwner");

      // cancel the takeover request
      await test.selectFrame("second");
      test.click(`*[data-messagebox-result=cancel]`);
      await test.wait(() => test.qR("#status").textContent === "Failed getting the lock");
      await test.selectFrame("main");
      await test.wait(() => /teun testuser \(teun@/.exec(test.qR(".mydialog").textContent || ""));

      await test.selectFrame("third");
      test.click(`*[data-messagebox-result=cancel]`);
      await test.wait(() => test.qR("#status").textContent === "Failed getting the lock");
      await test.selectFrame("main");
      await test.wait(() => !test.qS(".mydialog")); // wait for dialog to disappear
      test.click("#releaselock");
      await test.wait(() => test.qR("#status").textContent === "Lock not taken");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
    },
    "mutex lock",
    async function () {
      await test.selectFrame("main");
      test.click("#startexclusiveaccesstest");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.eq("yes", test.qR("#locked").textContent);

      const datatoken = test.qR("#locked").dataset.locktoken;

      // rpc with valid token
      let res = await test.invoke("mod::webhare_testsuite/webdesigns/basetest/pages/exclusiveaccesstest/exclusiveaccesstest.whlib#TestLockToken", datatoken, false);
      test.eq(true, res.success);

      // rpc when release during operation
      res = test.invoke("mod::webhare_testsuite/webdesigns/basetest/pages/exclusiveaccesstest/exclusiveaccesstest.whlib#TestLockToken", datatoken, true);
      await test.sleep(100); // wait for the mutex in the RPC lock
      test.click("#releaselock");
      await test.wait(() => test.qR("#status").textContent === "Lock not taken");

      // restart lock, should not get it until the RPC finishes
      test.click("#startexclusiveaccesstest");
      await test.sleep(100); // should not have gotten the lock after waiting
      test.assert(test.qR('html.dompack--busymodal')); // modal busy while waiting for the lock
      test.assert(test.qR("#status").textContent !== "Got lock");

      await test.invoke("mod::webhare_testsuite/webdesigns/basetest/pages/exclusiveaccesstest/exclusiveaccesstest.whlib#Resume");
      await test.wait(() => test.qR("#status").textContent === "Got lock");
      test.assert(!test.qS('html.dompack--busymodal'));
      test.click("#releaselock");
      test.assert(test.qR("#status").textContent !== "Lock not taken");
    }
  ]);
