import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";

async function testSiteProfiles() {
  const markdownfile = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  test.eq("http://www.webhare.net/xmlns/publisher/markdownfile", markdownfile.type);

  const publicationsettings = await (await getApplyTesterForObject(markdownfile)).getWebDesignInfo();
  test.eq("mod::webhare_testsuite/webdesigns/basetest/lib/basetest.whlib#BaseTestDesign", publicationsettings.objectName);

  const testsitefile = await whfs.openFile("site::webhare_testsuite.testsitejs/staticlogin/login");
  const wrdauth = await (await getApplyTesterForObject(testsitefile)).getWRDAuth();
  test.eq("wrd:testschema", wrdauth.wrdSchema);
  test.eq("currentsite::/portal1/", wrdauth.loginPage);
  test.eq("webharelogin-wrdauthjs", wrdauth.cookieName);

  const testsite = await whfs.openSite("webhare_testsuite.testsite");
  const testobj = await testsite.openFolder("testpages");

  await whdb.beginWork();
  await whfs.openType("webhare_testsuite:basetest.siteSettings").set(testsite.id, { mode: "", setting: "", when: null });
  await whdb.commitWork();

  await whdb.beginWork();
  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq(null, await tester.getUserData("webhare_testsuite:setting"));
  }

  await whfs.openType("webhare_testsuite:basetest.siteSettings").set(testsite.id, { mode: "blue" });
  await whdb.commitWork();

  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq({ dogName: "bluey", isDateSet: false }, await tester.getUserData("webhare_testsuite:setting"));
  }

  await whdb.beginWork();
  await whfs.openType("webhare_testsuite:basetest.siteSettings").set(testsite.id, { setting: "red", when: new Date("2024-01-01") });
  await whdb.commitWork();

  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq({ dogName: "bluey", sisterName: "bingo" }, await tester.getUserData("webhare_testsuite:setting"));
  }
}

async function testSiteUpdates() {
  const testsitejs = await whfs.openSite("webhare_testsuite.testsitejs");
  const tester = await getApplyTesterForObject(await testsitejs.openFolder("."));

  test.eq(null, await tester.getUserData("webhare_testsuite:blub"));

  await whdb.beginWork();
  await testsitejs.update({ webFeatures: [], webDesign: "publisher:nodesign" });
  test.eq(null, await testsitejs.getWebFeatures());
  test.eq("publisher:nodesign", await testsitejs.getWebDesign());

  const updateres = await testsitejs.update({ webFeatures: ["webhare_testsuite:testfeature"], webDesign: "webhare_testsuite:basetestjs" });
  test.eq(["webhare_testsuite:testfeature"], await testsitejs.getWebFeatures());
  test.eq("webhare_testsuite:basetestjs", await testsitejs.getWebDesign());
  await whdb.commitWork();

  await updateres.applied();

  const tester2 = await getApplyTesterForObject(await testsitejs.openFolder("."));
  test.eq({ fish: true }, await tester2.getUserData("webhare_testsuite:blub"));
}


test.run([
  testSuiteCleanup,
  testSiteProfiles,
  testSiteUpdates,
]);
