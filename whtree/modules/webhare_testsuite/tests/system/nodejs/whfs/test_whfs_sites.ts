import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, commitWork } from "@webhare/whdb";
import { createSite, listSites, openFolder, openSite } from "@webhare/whfs";
import { whconstant_whfsid_webhare_tests } from "@mod-system/js/internal/webhareconstants";

const siteName = "webhare_testsuite.sitetest";
const renamedSiteName = "webhare_testsuite.sitetest-renamed";

async function recycleTestSites() {
  for (const name of [siteName, renamedSiteName]) {
    const site = await openSite(name, { allowMissing: true });
    if (site)
      await (await openFolder(site.id)).recycle();
  }
}

async function prepare() {
  await beginWork();
  await recycleTestSites();
  await commitWork();
}

// Verifies creating a site from a folder
async function testCreateSite() {
  const testRoot = await openFolder(whconstant_whfsid_webhare_tests);

  ////////////////////////////////////////////////////////////////
  // STORY: A folder becomes a site with the requested settings, but without output
  await test.throws(/requires open work/, createSite(testRoot.id));

  await beginWork();
  const rootFolder = await testRoot.createFolder(siteName, { description: "Folder description" });
  await rootFolder.createFolder("subfolder");

  const site = await createSite(rootFolder.id, { webDesign: "webhare_testsuite:basetestjs", webFeatures: ["webhare_testsuite:actions", "platform:identityprovider"] });
  test.eq(rootFolder.id, site.id);
  test.eq(null, rootFolder.parentSite, "createSite doesn't touch the caller's folder objects");
  await rootFolder.refresh();
  test.eq(site.id, rootFolder.parentSite);
  test.eq(siteName, site.name);
  test.eq("Folder description", site.description, "The description defaults to that of the folder");
  test.eq(false, site.locked);
  test.eq("", site.lockReason);
  test.eq(null, site.webRoot);
  test.eq(null, site.outputWeb);
  test.eq("webhare_testsuite:basetestjs", await site.getWebDesign());
  test.eq(["platform:identityprovider", "webhare_testsuite:actions"], await site.getWebFeatures());
  await commitWork();

  test.eq(site.id, (await openSite(siteName)).id);
  test.eq(site.id, (await openFolder(`site::${siteName}/subfolder`)).parentSite);
  test.eqPartial([{ id: site.id, description: "Folder description", locked: false }], (await listSites(["description", "locked"])).filter(row => row.name === siteName));

  ////////////////////////////////////////////////////////////////
  // STORY: Folders that are in a site, or that contain one, can't become a site
  await beginWork();
  await test.throws(/already part of site 'webhare_testsuite.sitetest'/, createSite(site.id));
  await test.throws(/already part of site 'webhare_testsuite.sitetest'/, createSite((await openFolder(`site::${siteName}/subfolder`)).id));
  await test.throws(/already contains the site/, createSite(testRoot.id));
  await commitWork();
}

// Verifies updating a site's name, description and lock
async function testUpdateSite() {
  const site = await openSite(siteName);
  const rootFolder = await openFolder(site.id);

  ////////////////////////////////////////////////////////////////
  // STORY: Renaming a site renames its root folder
  await beginWork();
  await site.update({ name: renamedSiteName, description: "Site description" });
  test.eq(renamedSiteName, site.name);
  test.eq("Site description", site.description);
  test.eq(renamedSiteName, (await openFolder(site.id)).name);
  test.eq(null, await openSite(siteName, { allowMissing: true }));
  test.eq(site.id, (await openSite(renamedSiteName)).id);

  await rootFolder.refresh(); //it was renamed through another object
  await rootFolder.update({ name: siteName });
  test.eq(site.id, (await openSite(siteName)).id, "Renaming the site's root folder renames the site too");

  await site.update({ name: siteName });
  test.eq("Site description", site.description, "Settings we didn't pass are left alone");

  ////////////////////////////////////////////////////////////////
  // STORY: Locking and unlocking a site
  await site.update({ locked: true, lockReason: "Being tested" });
  test.eq(true, site.locked);
  test.eq("Being tested", site.lockReason);
  test.eq([{ id: site.id, name: siteName, locked: true, lockReason: "Being tested" }], (await listSites(["locked", "lockReason"])).filter(row => row.id === site.id));

  await site.update({ locked: false, lockReason: "" });
  const reopened = await openSite(site.id);
  test.eq(false, reopened.locked);
  test.eq("", reopened.lockReason);
  await commitWork();
}

// Verifies setting a site's output to a folder on a webserver and to a foreign folder in another site
async function testSiteOutput() {
  const site = await openSite(siteName);
  const testSite = await test.getTestSiteJS();
  const tmpFolder = await test.getTestSiteJSTemp();
  test.assert(testSite.outputWeb);

  ////////////////////////////////////////////////////////////////
  // STORY: Publishing to a free folder on a webserver. The folder is normalized
  await beginWork();
  await site.setOutput({ webServer: testSite.outputWeb, folder: "testoutput//webhare_testsuite.sitetest" });
  test.eq(testSite.outputWeb, site.outputWeb);
  test.eq("/testoutput/webhare_testsuite.sitetest/", site.outputFolder);
  test.eq(new URL("/testoutput/webhare_testsuite.sitetest/", testSite.webRoot).toString(), site.webRoot);
  test.eq(site.webRoot, (await openSite(site.id)).webRoot);

  ////////////////////////////////////////////////////////////////
  // STORY: Locations used by another site are refused, and so are locations inside one without a foreign folder
  await test.throws(/Site 'webhare_testsuite.testsitejs' is already published at/, site.setOutput({ webServer: testSite.outputWeb, folder: testSite.outputFolder }));
  await test.throws(/Site 'webhare_testsuite.testsitejs' needs a foreign folder at 'tmp\/nosuchfolder\/'/, site.setOutput({ webServer: testSite.outputWeb, folder: testSite.outputFolder + "tmp/nosuchfolder" }));
  await test.throws(/Invalid webserver #0/, site.setOutput({ webServer: 0, folder: "/" }));
  test.eq("/testoutput/webhare_testsuite.sitetest/", (await openSite(site.id)).outputFolder, "A refused output changes nothing");

  ////////////////////////////////////////////////////////////////
  // STORY: Publishing into another site creates a foreign folder there, and its missing parents as normal folders
  await site.setOutput({ site: testSite, folder: "tmp/out-a/out-b/out-c" });
  test.eq(testSite.outputWeb, site.outputWeb);
  test.eq(testSite.outputFolder + "tmp/out-a/out-b/out-c/", site.outputFolder);
  test.eq(testSite.webRoot + "tmp/out-a/out-b/out-c/", site.webRoot);
  test.eq("platform:foldertypes.default", (await tmpFolder.openFolder("out-a")).type);
  test.eq("platform:foldertypes.default", (await tmpFolder.openFolder("out-a/out-b")).type);
  test.eq("platform:foldertypes.extern", (await tmpFolder.openFolder("out-a/out-b/out-c")).type);

  ////////////////////////////////////////////////////////////////
  // STORY: A path below an existing foreign folder needs nothing created
  await site.setOutput({ site: testSite, folder: "tmp/out-a/out-b/out-c/deeper" });
  test.eq(testSite.webRoot + "tmp/out-a/out-b/out-c/deeper/", site.webRoot);
  test.eq(null, await tmpFolder.openFolder("out-a/out-b/out-c/deeper", { allowMissing: true }));

  ////////////////////////////////////////////////////////////////
  // STORY: An empty normal folder is converted to a foreign folder, anything else in the way is an error
  await tmpFolder.createFolder("out-empty");
  const fullFolder = await tmpFolder.createFolder("out-full");
  await fullFolder.createFile("a-file");

  await site.setOutput({ site: testSite, folder: "tmp/out-empty" });
  test.eq(testSite.webRoot + "tmp/out-empty/", site.webRoot);
  test.eq("platform:foldertypes.extern", (await tmpFolder.openFolder("out-empty")).type);

  await test.throws(/out-full\/' is not empty/, site.setOutput({ site: testSite, folder: "tmp/out-full" }));
  await test.throws(/a-file' is a file/, site.setOutput({ site: testSite, folder: "tmp/out-full/a-file/sub" }));
  await test.throws(/Invalid folder/, site.setOutput({ site: testSite, folder: "tmp/../out-full" }));
  await test.throws(/cannot be published into itself/, site.setOutput({ site, folder: "self" }));
  test.eq(testSite.webRoot + "tmp/out-empty/", site.webRoot);

  ////////////////////////////////////////////////////////////////
  // STORY: Removing the output, after which the site can't be published into
  await site.setOutput(null);
  test.eq(null, site.outputWeb);
  test.eq("", site.outputFolder);
  test.eq(null, (await openSite(site.id)).webRoot);
  await test.throws(/that site has no output/, testSite.setOutput({ site, folder: "sub" }));
  await commitWork();
}

test.runTests([
  test.resetWTS,
  prepare,
  testCreateSite,
  testUpdateSite,
  testSiteOutput,
]);
