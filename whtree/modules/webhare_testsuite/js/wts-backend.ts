/* wts-backend extends @webhare/test-backend with resources that only exist in webhare_testsuite, eg the webhare_testsuite.testsite* sites */
import * as test from "@webhare/test-backend";
export * from "@webhare/test-backend";

import { beginWork, commitWork } from "@webhare/whdb";
import { openFileOrFolder, openFolder, openSite } from "@webhare/whfs";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteHSTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}
export async function getTestSiteJSTemp() {
  return await openFolder("site::webhare_testsuite.testsitejs/tmp");
}

export async function getTestSiteHS() {
  return await openSite("webhare_testsuite.testsite");
}
export async function getTestSiteJS() {
  return await openSite("webhare_testsuite.testsitejs");
}

export async function getWHFSTestRoot() {
  return await openFolder("/webhare-tests/webhare_testsuite.testfolder");
}

export async function resetWTS(options?: test.ResetOptions) {
  await test.reset(options);

  await beginWork();

  for (const tmpfoldername of ["site::webhare_testsuite.testsite/tmp", "site::webhare_testsuite.testsitejs/tmp"]) {
    const tmpfolder = await openFolder(tmpfoldername, { allowMissing: true });
    if (tmpfolder) {
      for (const item of await tmpfolder.list()) {
        //FIXME openObjects would still be very useful
        const obj = await openFileOrFolder(item.id);
        await obj.delete(); //FIXME we desire recyle
      }
    }
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await getTestSiteJS();
  test.assert(testsitejs, "We need the JS testsite to exist");

  let updateres;
  if (JSON.stringify(await testsitejs.getWebFeatures()) !== JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() !== "webhare_testsuite:basetestjs") {
    updateres = await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await commitWork();
  if (updateres)
    await updateres.applied();
}
