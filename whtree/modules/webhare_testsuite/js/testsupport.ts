import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";
import { openFileOrFolder, openFolder } from "@webhare/whfs";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}

export async function testSuiteCleanup() {
  await beginWork();

  const tmpfolder = await openFolder("site::webhare_testsuite.testsite/tmp", { allowMissing: true });
  if (tmpfolder) {
    for (const item of await tmpfolder.list()) {
      //FIXME openObjects would still be very useful
      const obj = await openFileOrFolder(item.id);
      await obj.delete(); //FIXME we desire recyle
    }
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await whfs.openSite("webhare_testsuite.testsitejs");
  test.assert(testsitejs, "We need the JS testsite to exist");

  let updateres;
  if (JSON.stringify(await testsitejs.getWebFeatures()) != JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() != "webhare_testsuite:basetestjs") {
    updateres = await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await commitWork();
  if (updateres)
    await updateres.applied();
}
