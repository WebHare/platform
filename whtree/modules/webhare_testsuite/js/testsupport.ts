import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";
import { openFileOrFolder, openFolder } from "@webhare/whfs";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}

export async function getTestSiteHS() {
  return await whfs.openSite("webhare_testsuite.testsite");
}
export async function getTestSiteJS() {
  return await whfs.openSite("webhare_testsuite.testsitejs");
}

export const testValues = {
  //CreateWebharePasswordHash is SLOW. prepping passwords is worth the trouble. Using snakecase so the text exactly matches the password
  pwd_test: "WHBF:$2y$10$WiHCQT62TCzqcTLGURXPc.dU82JTaAyLizm4F5HAQO8hpnxg2qK4.",
  pwd_secret: "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO",
  pwd_secret$: "WHBF:$2y$10$WUm2byXgMFDDa0nmSCLtUO0uNyMoHNmZhNm2YjWLNq8NmV15oFMDG",
};

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
