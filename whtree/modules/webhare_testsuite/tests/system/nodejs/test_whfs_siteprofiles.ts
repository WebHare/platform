import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { getApplyTesterForMockedObject, getApplyTesterForObject, getApplyTesterForURL } from "@webhare/whfs/src/applytester";

async function getApplyTester(path: string) {
  return await getApplyTesterForObject(await whfs.openFile(path));
}

async function getMyCustomNodesThroughYaml(obj: whfs.WHFSObject): Promise<string> {
  const tester = await getApplyTesterForObject(obj);
  const rows = await tester.getPluginSettings("webhareTestsuite:testYaml");
  return rows.map(_ => _.dataAttribute).join(",");
}

async function testBeforeSite() { //port of HS TestBeforeSite
  await whdb.beginWork();

  const siteroot2 = await (await test.getWHFSTestRoot()).ensureFolder("webhare_testsuite.site2");
  const aSystemFolder = await (await test.getTestSiteHSTemp()).createFolder("systemfolder", { type: "http://www.webhare.net/xmlns/publisher/systemfolder" });
  const aSlotsFolder = await aSystemFolder.createFolder("slotsfolder", { type: "http://www.webhare.net/xmlns/publisher/contentlibraries/slots" });
  const aBeaconFolder = await aSlotsFolder.createFolder("beaconsfolder", { type: "http://www.webhare.net/xmlns/publisher/contentlibraries/beacons" });
  const subFile = await aBeaconFolder.createFile("subfile");

  await whdb.commitWork();

  const siteroot2Tester = await getApplyTesterForObject(siteroot2);
  test.eq([
    {
      source: {
        siteProfile: 'mod::webhare_testsuite/data/webhare_testsuite.siteprl.xml'
      }, dataAttribute: "applytest-megaglobal"
    },
    {
      source: {
        siteProfile: 'mod::webhare_testsuite/data/webhare_testsuite.siteprl.xml'
      }, dataAttribute: "applytest-whfspath"
    }
  ], await siteroot2Tester.getPluginSettings("webhareTestsuite:testYaml"));

  test.eq(null, siteroot2.parentSite);
  test.eq('/webhare-tests/webhare_testsuite.testfolder/webhare_testsuite.site2/', siteroot2.whfsPath);
  test.eq("applytest-megaglobal,applytest-whfspath", await getMyCustomNodesThroughYaml(siteroot2));
  // test.eq("intercept-whfspath,intercept-megaglobal", GetMyIntercepts(siteroot2.id));

  test.eq("applytest-megaglobal,parentmask-tmp,parentregex-tmp,is-system-folder", await getMyCustomNodesThroughYaml(aSystemFolder));
  test.eq("applytest-megaglobal,in-system-folder,is-slots-folder", await getMyCustomNodesThroughYaml(aSlotsFolder));
  test.eq("applytest-megaglobal,in-system-folder,in-slots-folder,is-beacons-folder", await getMyCustomNodesThroughYaml(aBeaconFolder));
  test.eq("applytest-megaglobal,in-system-folder,in-slots-folder,in-beacons-folder", await getMyCustomNodesThroughYaml(subFile));
}

async function testSiteProfiles() {
  const markdownfile = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  test.eq("platform:filetypes.markdown", markdownfile.type);

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

  {
    //Widget settings
    const tester = await getApplyTesterForObject(testobj);
    test.eq({
      renderHS: "mod::webhare_testsuite/webdesigns/basetest/lib/basetest.whlib#Level2Widget",
      renderJS: ""
    }, await tester.getWidgetSettings("http://www.webhare.net/xmlns/webhare_testsuite/rtd/embedlvl2"));
    test.eq({
      renderHS: "",
      renderJS: "mod::webhare_testsuite/webdesigns/basetestjs/webdesign/webdesign.ts#renderJSWidget1"
    }, await tester.getWidgetSettings("webhare_testsuite:base_test.jswidget1"));

    await whdb.beginWork();
    const dummyfile = await (await test.getTestSiteHSTemp()).createFile('override-widget-search');
    const dummytester = await getApplyTesterForObject(dummyfile);

    test.eq({
      renderHS: "mod::webhare_testsuite/webdesigns/basetest/lib/basetest.whlib#Level2Widget_OverrideSearch",
      renderJS: ""
    }, await dummytester.getWidgetSettings("http://www.webhare.net/xmlns/webhare_testsuite/rtd/embedlvl2"));

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
  test.resetWTS,
  testBeforeSite,
  testSiteProfiles,
  testSiteUpdates,
]);
