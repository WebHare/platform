import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, commitWork } from "@webhare/whdb";
import { createSite, listSites, openFolder, openSite } from "@webhare/whfs";
import { whconstant_whfsid_webhare_tests } from "@mod-system/js/internal/webhareconstants";

const siteName = "webhare_testsuite.sitetest";

async function recycleTestSite() {
  const site = await openSite(siteName, { allowMissing: true });
  if (site)
    await (await openFolder(site.id)).recycle();
}

async function prepare() {
  await beginWork();
  await recycleTestSite();
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

test.runTests([
  test.resetWTS,
  prepare,
  testCreateSite,
]);
