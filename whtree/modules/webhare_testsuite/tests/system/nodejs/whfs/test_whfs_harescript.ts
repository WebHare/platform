//We test the usability of WHFS APIs which we'll need until JS WHFS is done

import * as test from "@webhare/test";
import { loadlib } from "@webhare/harescript";
import { beginWork, commitWork, isWorkOpen } from "@webhare/whdb";
import { generateRandomId } from "@webhare/std";
import { WebHareBlob } from "@webhare/services/src/webhareblob";

async function setup() {
  await loadlib("mod::system/lib/testframework.whlib").runTestFramework([]);
  const uuid = generateRandomId();

  test.assert(!isWorkOpen());
  test.eq(null, await loadlib("mod::publisher/lib/siteapi.whlib").openSiteByName("__nosuchsite__"));
  const testsite = await loadlib("mod::publisher/lib/siteapi.whlib").openSiteByName("webhare_testsuite.testsite");
  test.assert(testsite);

  const tmpfolder = await testsite.openByPath("tmp");
  test.assert(tmpfolder);

  console.log("creating file");
  await beginWork();
  const file = await tmpfolder.ensureFile({ name: "file.txt", publish: true, data: WebHareBlob.from("Ik ben data " + uuid) });
  test.eq("file.txt", await (await tmpfolder.openByName("file.txt")).$get("name"));
  console.log("..commit");
  await commitWork();

  console.log("wait for publish completion");
  test.assert(await loadlib("mod::publisher/lib/control.whlib").waitForPublishCompletion(await testsite.$get("id")));

  const url = await file.$get("link");
  const output = await fetch(url);
  test.eq("Ik ben data " + uuid, await output.text());

  await beginWork();
  const moddate = new Date("2020-02-02T20:20:20");
  await (await tmpfolder.openByName("file.txt")).SetInstanceData("http://www.webhare.net/xmlns/publisher/lifecycle", { deletion: new Date() });
  await (await tmpfolder.openByName("file.txt")).UpdateMetaData({ modificationDate: moddate });
  await commitWork();
  /*TODO: Fails, because SetInstanceData triggers an empty update on commit, causing the modification date to be updated to 'now'
  test.eq(moddate, await (await tmpfolder.openByName("file.txt")).$get("modificationDate"));
  */
}

test.runTests([setup]);
