/* Note: you need two webhares to run this test. See twoharetests.sh

   To see what Puppeteer is doing:
   WEBHARE_DEBUG=test-showbrowser wh run mod::webhare_testsuite/tests/system/twohare/test_peerserver.ts

   To get a REPL if the test fails:
   WEBHARE_DEBUG=test-keepbrowser wh run mod::webhare_testsuite/tests/system/twohare/test_peerserver.ts
*/

import { loadlib } from "@webhare/harescript";
import * as test from "@mod-webhare_testsuite/js/wts-backend";

import type { Puppeteer } from "@webhare/deps";
import { readRegistryKey } from "@webhare/services";
import { throwError } from "@webhare/std";
import { openTestPuppeteer, runWebHareLoginFlow } from "@mod-webhare_testsuite/js/wts-backend";

async function setupPeerServerTest() {
  await test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop"] },
    },
  });
}

async function connectToPeer() {
  const puppeteer = await openTestPuppeteer();
  const page = (await puppeteer.pages())[0];

  const testportal: string = await loadlib("mod::tollium/lib/internal/headlesscontroller.whlib").GetTestTolliumPortalURL();
  await page.goto(testportal + "?app=publisher(/webhare-tests/webhare_testsuite.testsite/tmp)/managefoldersync/add/selectpeer&notifications=0");

  await runWebHareLoginFlow(page);

  //Use 'await test.runTestPuppeteerRepl();' to insert debug stops and allow you to manually inspect/figure out locator calls

  await page.locator('::-p-aria(Add)').click();
  await page.locator('::-p-aria(Server URL)').fill(await readRegistryKey("webhare_testsuite:tests.secondhareinterface"));

  const newPagePromise = new Promise<Puppeteer.Page | null>(resolve =>
    puppeteer.once('targetcreated', target => resolve(target.page()))
  );
  await page.locator('::-p-aria(Connect)').click(); //opens the seconds webhare in a new tab

  //STORY: log in on new server, approve the request
  const secondHare = await newPagePromise ?? throwError("Failed to get new page");
  await runWebHareLoginFlow(secondHare, { rawUser: "twoharetest@beta.webhare.net", password: "secret" });
  const pageClosedPromise = new Promise(resolve => secondHare.once('close', resolve));
  await secondHare.locator('::-p-aria(Approve)').click(); //opens the second webhare in a new tab
  console.log('wait for tab to close');
  await pageClosedPromise; //second tab should autoclose

  console.log("Wait for WebHare servers screen to become active again");
  await page.locator('.t-screen.active .windowheader ::-p-text(WebHare servers)').wait(); //both screen have a Connect button so wait for the right one to be tehre
  await page.locator('::-p-aria(Connect)').click();
  await page.locator('::-p-aria(Select folder)').click();
  await page.locator('.t-screen.active .windowheader ::-p-text(Select remote folder)').wait();
  await page.locator('::-p-aria(OK)').click();

  test.eq("/webhare-tests/webhare_testsuite.testsite/tmp", await (await (await page.locator('::-p-aria(Remote path)').waitHandle()).getProperty("value")).jsonValue());
}

test.runTests([
  setupPeerServerTest, //implies test.reset
  connectToPeer
]);
