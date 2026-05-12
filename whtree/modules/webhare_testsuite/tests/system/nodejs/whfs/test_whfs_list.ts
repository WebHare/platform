import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { isTemporalInstant } from "@webhare/std";
import * as whfs from "@webhare/whfs";

async function testListSites() {
  const testsite = await test.getTestSiteHS();
  const testsitejs = await test.getTestSiteJS();

  //verify listSites and exact typing of response value
  test.eq({ id: testsite.id, name: "webhare_testsuite.testsite" }, (await whfs.listSites()).find(_ => _.name === "webhare_testsuite.testsite"));
  test.eq({ id: testsite.id, name: "webhare_testsuite.testsite" }, (await whfs.listSites([])).find(_ => _.name === "webhare_testsuite.testsite"));

  const testSites = (await whfs.listSites(["webDesign", "webFeatures"])).filter(_ => _.name === "webhare_testsuite.testsite" || _.name === "webhare_testsuite.testsitejs").toSorted((a, b) => a.name.localeCompare(b.name));
  test.eq([
    { id: testsite.id, name: "webhare_testsuite.testsite", webDesign: "webhare_testsuite:basetest", webFeatures: null },
    { id: testsitejs.id, name: "webhare_testsuite.testsitejs", webDesign: "webhare_testsuite:basetestjs", webFeatures: ["platform:identityprovider"] }
  ], testSites);

}

async function testListObjects() {
  const testsite = await test.getTestSiteHS();
  const testsitejs = await test.getTestSiteJS();
  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile.parent);

  const testpagesfolder = await whfs.openFolder(markdownfile.parent);
  const testpagesfolderAsFileOrfolder = await whfs.openFileOrFolder(markdownfile.parent);
  //@ts-expect-error TS is unsure whether it's a file or folder
  testpagesfolderAsFileOrfolder.list satisfies (...args: any[]) => any;
  test.assert(testpagesfolderAsFileOrfolder.isFolder);
  //checking isFolder triggers a type assertion and now we *do* know its folder and that list() exists
  testpagesfolderAsFileOrfolder.list satisfies (...args: any[]) => any;

  const list = await testpagesfolder.list(["parent", "publish", "isUnlisted"]);
  test.assert(list.length > 5, "should be a lot of files/folders in this list");
  test.eq([
    {
      id: markdownfile.id,
      name: markdownfile.name,
      isFolder: false,
      isUnlisted: true,
      parent: testpagesfolder.id,
      publish: true
    }
  ], list.filter(e => e.name === markdownfile.name));
  test.eqPartial({ publish: false }, list.find(e => e.name === "unpublished"));

  const list2 = await testpagesfolder.list(["type", "sitePath", "whfsPath"]);
  test.eqPartial({
    type: "platform:filetypes.richdocument",
    sitePath: '/TestPages/staticpage-ps-af',
    whfsPath: '/webhare-tests/webhare_testsuite.testsite/TestPages/staticpage-ps-af'
  }, list2.find(_ => _.name === 'staticpage-ps-af'));

  const list3 = await testpagesfolder.list(["created", "modified", "contentModified"]);
  test.eqPartial({
    created: date => isTemporalInstant(date),
    modified: date => isTemporalInstant(date),
    contentModified: date => isTemporalInstant(date),
  }, list3.find(_ => _.name === 'staticpage-ps-af'));

  test.eq({ id: markdownfile.id, name: markdownfile.name, isFolder: false }, (await testpagesfolder.list()).find(e => e.name === markdownfile.name), "Verify list() works without any keys");
  test.eq({ id: markdownfile.id, name: markdownfile.name, isFolder: false }, (await testpagesfolder.list([])).find(e => e.name === markdownfile.name), "Verify list() works with empty keys");

  const listPlain = await testsitejs.list([], {});
  test.assert(!("parent" in listPlain[0]), "without keys, no extra properties should be present");
  test.assert(!("path" in listPlain[0]), "path is never returend by list()");

  const listDepth1 = await testsitejs.listRecursive([], { maxDepth: 1 });
  test.eqPartial([{ parent: testsitejs.id, path: "photoalbum", name: "photoalbum" }], listDepth1.filter(_ => _.name === "photoalbum"));
  test.eq([], listDepth1.filter(_ => _.name === "landscape_5.jpg"));

  const listDepth2 = await testsitejs.listRecursive([], { maxDepth: 2 });
  const photoalbum = listDepth2.filter(_ => _.name === "photoalbum");
  test.eqPartial([{ parent: testsitejs.id, path: "photoalbum", name: "photoalbum" }], photoalbum);
  test.eqPartial([{ parent: photoalbum[0].id, path: "photoalbum/landscape_5.jpg", name: "landscape_5.jpg" }], listDepth2.filter(_ => _.name === "landscape_5.jpg"));


}

test.runTests([
  test.resetWTS,
  testListSites,
  testListObjects
]);
