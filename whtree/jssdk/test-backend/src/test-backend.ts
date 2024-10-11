/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

import * as test from "@webhare/test";
import { beginWork } from "@webhare/whdb";
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

export const passwordHashes = {
  //CreateWebharePasswordHash is SLOW. prepping passwords is worth the trouble. Using snakecase so the text exactly matches the password
  test: "WHBF:$2y$10$WiHCQT62TCzqcTLGURXPc.dU82JTaAyLizm4F5HAQO8hpnxg2qK4.",
  secret: "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO",
  secret$: "WHBF:$2y$10$WUm2byXgMFDDa0nmSCLtUO0uNyMoHNmZhNm2YjWLNq8NmV15oFMDG",
};

export interface ResetOptions {

}

/** Reset the test framework */
export async function reset(options?: ResetOptions) {
  await using work = await beginWork();

  const tmpfolder = await openFolder("site::webhare_testsuite.testsite/tmp", { allowMissing: true });
  if (tmpfolder) {
    for (const item of await tmpfolder.list()) {
      //FIXME openObjects would still be very useful
      const obj = await openFileOrFolder(item.id);
      await obj.delete(); //FIXME we desire recyle
    }
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await getTestSiteJS();
  test.assert(testsitejs, "We need the JS testsite to exist");

  let updateres;
  if (JSON.stringify(await testsitejs.getWebFeatures()) !== JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() !== "webhare_testsuite:basetestjs") {
    updateres = await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await work.commit();
  if (updateres)
    await updateres.applied();
}


//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";
