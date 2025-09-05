import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { getApplyTesterForMockedObject, getApplyTesterForObject, getApplyTesterForURL } from "@webhare/whfs/src/applytester";

async function getApplyTester(path: string) {
  return await getApplyTesterForObject(await whfs.openFile(path));
}

async function testSiteProfiles() {
  const markdownfile = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  test.eq("http://www.webhare.net/xmlns/publisher/markdownfile", markdownfile.type);

  const publicationsettings = await (await getApplyTesterForObject(markdownfile)).getWebDesignInfo();
  test.eq("mod::webhare_testsuite/webdesigns/basetest/lib/basetest.whlib#BaseTestDesign", publicationsettings.objectName);

  test.eq("en", await (await getApplyTester("site::webhare_testsuite.testsitejs/testpages/markdownpage")).getSiteLanguage(), "Undefined falls back to 'en'");
  test.eq("ps-AF", await (await getApplyTester("site::webhare_testsuite.testsitejs/testpages/staticpage-ps-af")).getSiteLanguage());

  {
    const emptyfolder = await (await test.getTestSiteJS()).openFolder("testsuiteportal/empty folder");
    test.eq([], await emptyfolder.list());
    test.eq(null, emptyfolder.link);
    test.eq((await test.getTestSiteJS()).webRoot + "testsuiteportal/empty%20folder/", await emptyfolder.getBaseURL());

    const tester = await getApplyTesterForURL((await emptyfolder.getBaseURL())!);
    test.assert(tester);
    test.eqPartial({ wrdSchema: "webhare_testsuite:testschema" }, await tester.getWRDAuth());
  }

  const testsitefile = await whfs.openFile("site::webhare_testsuite.testsitejs/staticlogin/login");
  const wrdauth = await (await getApplyTesterForObject(testsitefile)).getWRDAuth();
  test.eq("webhare_testsuite:testschema", wrdauth.wrdSchema);
  test.eq("currentsite::/portal1/", wrdauth.loginPage);
  test.eq("webharelogin-wrdauthjs", wrdauth.cookieName);
  test.eq('mod::webhare_testsuite/webdesigns/basetestjs/webdesign/auth.ts#TestAuthCustomizer', wrdauth.customizer);

  const wrdauthFromMock = await (await getApplyTesterForMockedObject(await testsitefile.openParent(), true, testsitefile.type)).getWRDAuth();
  test.eq(wrdauth, wrdauthFromMock);

  const testsite = await test.getTestSiteHS();
  const testobj = await testsite.openFolder("testpages");

  await whdb.beginWork();
  await whfs.openType("webhare_testsuite:base_test.site_settings").set(testsite.id, { mode: "", setting: "", when: null });
  await whdb.commitWork();

  await whdb.beginWork();
  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq(null, await tester.getUserData("webhare_testsuite:setting"));
  }

  await whfs.openType("webhare_testsuite:base_test.site_settings").set(testsite.id, { mode: "blue" });
  await whdb.commitWork();

  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq({ dogName: "bluey", isDateSet: false }, await tester.getUserData("webhare_testsuite:setting"));
  }

  await whdb.beginWork();
  await whfs.openType("webhare_testsuite:base_test.site_settings").set(testsite.id, { setting: "red", when: new Date("2024-01-01") });
  await whdb.commitWork();

  {
    const tester = await getApplyTesterForObject(testobj);
    test.eq({ dogName: "bluey", sisterName: "bingo" }, await tester.getUserData("webhare_testsuite:setting"));
    test.eq(false, tester.isMocked());
    test.eq("/TestPages/", testobj.sitePath);
    test.eq({ nameIsTestpage: true }, await tester.getUserData("webhare_testsuite:nameinfo"));
  }

  {
    //If we recycle a file the applytester should see throufg hthis
    await whdb.beginWork();
    await testobj.recycle();
    const tester = await getApplyTesterForObject(await whfs.openFolder(testobj.id, { allowHistoric: true }));
    test.eq(true, tester.isMocked());

    test.eq({ nameIsTestpage: true }, await tester.getUserData("webhare_testsuite:nameinfo"));
    test.eq({ dogName: "bluey", sisterName: "bingo" }, await tester.getUserData("webhare_testsuite:setting")); //not sure if we need t oreload
    await whdb.rollbackWork();
  }

}

async function testSiteUpdates() {
  const testsitejs = await test.getTestSiteJS();
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


test.runTests([
  test.reset,
  testSiteProfiles,
  testSiteUpdates,
]);
