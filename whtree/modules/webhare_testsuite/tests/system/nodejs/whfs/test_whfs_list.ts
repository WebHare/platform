import { getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { getAuthorizationUsers } from "@webhare/auth";
import { isTemporalInstant } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { openFolder } from "@webhare/whfs";
import { wrd } from "@webhare/wrd";

async function testListSites() {
  const testsite = await test.getTestSiteHS();
  const testsitejs = await test.getTestSiteJS();

  await beginWork();
  await testsite.update({ webFeatures: [] });
  await commitWork();

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
  const landScape5 = await testsite.openFile("photoalbum/landscape_5.jpg");

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

  // Test list()ing any object
  test.eq([{
    id: landScape5.id,
    name: landScape5.name,
    isFolder: false,
  }, {
    id: markdownfile.id,
    name: markdownfile.name,
    isFolder: false,
  }], (await whfs.listWHFSObjects(["id", "name", "isFolder"], { ids: [landScape5.id, markdownfile.id] })).toSorted((a, b) => a.name.localeCompare(b.name)));

  test.eq([{
    id: landScape5.id,
    name: landScape5.name,
    isFolder: false,
    parent: landScape5.parent
  }], (await whfs.listWHFSObjects(["id", "name", "isFolder", "parent"], { ids: [landScape5.id] })));

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

  //List by type
  const folderImages = await (await whfs.openFolder(photoalbum[0].id)).list([], { types: ["platform:filetypes.image"] });
  test.eq(["goudvis.png", "homersbrain.bmp", "landscape_5.jpg", "portrait_4.jpg", "snowbeagle.avif", "snowbeagle.jpg", "snowbeagle.webp"], folderImages.map(_ => _.name).toSorted());

  const unknownFiles = await testpagesfolder.list([], { types: ["platform:filetypes.unknown"] });
  test.eq(["unknownfile"], unknownFiles.map(_ => _.name).toSorted());
  test.assert(!("type" in unknownFiles[0]), "should not have returned type unless explicitly requested");

  test.eqPartial([{ name: "unknownfile", type: "platform:filetypes.unknown" }], await testpagesfolder.list(["type"], { types: ["platform:filetypes.unknown"] }));

  //List by type recursive. Needs to be smart enough to descend into folders that don't match its type
  const siteImages = await testsitejs.listRecursive(["data"], { maxDepth: 2, types: ["platform:filetypes.image"] });
  test.eq(["goudvis.png", "homersbrain.bmp", "imgeditfile.jpeg", "landscape_5.jpg", "portrait_4.jpg", "rangetestfile.jpeg", "snowbeagle.avif", "snowbeagle.jpg", "snowbeagle.webp"], siteImages.map(_ => _.name).toSorted());
  const siteImmageGoudvis = siteImages.find(_ => _.name === "goudvis.png");
  test.eq(75125, siteImmageGoudvis?.data?.file.size);
  test.eq(test.wellKnownHashes.goudvisPNG, siteImmageGoudvis?.data?.hash);
  test.eq("goudvis.png", siteImmageGoudvis?.data?.fileName);

  //List globally by type
  const allImages = await whfs.listWHFSObjects(["parent", "type"], { types: ["platform:filetypes.image"] });
  test.assert(allImages.find(_ => _.parent === photoalbum[0].id && _.name === "landscape_5.jpg"), "Should find landscape_5.jpg in global list by type");

  await beginWork();
  //Pick an uncommon filetype so we can realistically globally list
  const newobj = await (await test.getTestSiteJSTemp()).createFile("testfile", { modifiedBy: test.getUser("marge").auth, type: "platform:filetypes.xml" });
  const newobj2 = await (await test.getTestSiteJSTemp()).createFile("testfile2", { modifiedBy: test.getUser("marge").auth });
  const newobjLisa = await (await test.getTestSiteJSTemp()).createFile("testfile-lisa", { modifiedBy: test.getUser("lisa").auth });

  const listWithModifiedBy = await whfs.listWHFSObjects(["modifiedBy"], { ids: [newobj.id, newobj2.id] });
  const newobjModBy = listWithModifiedBy[0].modifiedBy;
  test.assert(newobjModBy, "modifiedBy should be present in list when requested");
  test.eq(test.getUser("marge").wrdId, (await getAuthorizationUsers(await getWRDSchema(), [newobjModBy])).get(newobjModBy));
  test.assert(listWithModifiedBy[0].modifiedBy === listWithModifiedBy[1].modifiedBy, "Both modifiedBys should be the same object as they're the same user");

  const listWithModifiedBy2 = await whfs.listWHFSObjects(["modifiedBy"], { ids: [newobj.id, newobjLisa.id] });
  test.assert(listWithModifiedBy2[0].modifiedBy !== listWithModifiedBy2[1].modifiedBy, "modifiedBy should be present in list when requested");

  await test.throws(/userSchema/, whfs.listWHFSObjects(["modifiedByEntity"], { ids: [newobj.id] }));
  const listWithModifiedByEntity = await whfs.listWHFSObjects(["modifiedByEntity"], { ids: [newobj.id], userSchema: await getWRDSchema() });
  test.eq(test.getUser("marge").wrdId, listWithModifiedByEntity[0].modifiedByEntity);
  const listWithModifiedByEntity_WrongSchema = await whfs.listWHFSObjects(["modifiedByEntity"], { ids: [newobj.id], userSchema: wrd("system:usermgmt") });
  test.eq(null, listWithModifiedByEntity_WrongSchema[0].modifiedByEntity);
  test.eq(false, "modifiedBy" in listWithModifiedByEntity[0]);

  await newobj.recycle();
  await commitWork();

  test.eq(0, (await whfs.listWHFSObjects([], { ids: [newobj.id] })).length, "Recycled object should not appear in list");
  test.eq(1, (await whfs.listWHFSObjects([], { ids: [newobj.id], allowHistoric: true })).length, "Recycled object should appear when opting in");
  test.eq(0, (await whfs.listWHFSObjects([], { types: ["platform:filetypes.xml"] })).filter(_ => _.id === newobj.id).length, "Recycled object should not appear in list-by-type");
  test.eq(1, (await whfs.listWHFSObjects([], { types: ["platform:filetypes.xml"], allowHistoric: true })).filter(_ => _.id === newobj.id).length, "Recycled object should appear in list-by-type when opting in");

  const deletedParent = await whfs.openFolder((await whfs.openFile(newobj.id, { allowHistoric: true })).parent!, { allowHistoric: true });
  test.eq(0, (await deletedParent.list([])).length, "Recycled object should not appear in list of its parent when not allowing versions");
  test.eq(1, (await deletedParent.list([], { allowHistoric: true })).filter(_ => _.id === newobj.id).length, "Recycled object should appear in list of its parent when allowing versions");
}

async function testListRoot() {
  const throughObject = await (await openFolder("/", { allowRoot: true })).list(["parent"]);
  test.eq([], throughObject.filter(_ => _.parent !== null).slice(0, 10));
  test.eq({ id: 10, name: 'webhare-private', isFolder: true, parent: null }, throughObject.find(_ => _.name === "webhare-private"), "Should be able to list the root folder and find webhare-private in it");

  const throughGlobal = await whfs.listWHFSObjects(["parent"], { parent: null });
  test.eq([], throughGlobal.filter(_ => _.parent !== null).slice(0, 10));
  test.eq({ id: 10, name: 'webhare-private', isFolder: true, parent: null }, throughGlobal.find(_ => _.name === "webhare-private"), "Should be able to list with parent=null and find webhare-private in it");

  //this is a DB cornercase as it has to build: parent is null OR parent in [1,2,3]
  const testsitejs = await test.getTestSiteJS();
  const throughGlobalAndFolder = await whfs.listWHFSObjects(["parent"], { parent: [null, 1, testsitejs.id] });
  test.eq([], throughGlobalAndFolder.filter(_ => _.parent !== null && _.parent !== 1 && _.parent !== testsitejs.id).slice(0, 10));
  test.eq({ id: 10, name: 'webhare-private', isFolder: true, parent: null }, throughGlobalAndFolder.find(_ => _.name === "webhare-private" && _.parent === null));
  test.assert(throughGlobalAndFolder.find(_ => _.name === "TestPages" && _.parent === testsitejs.id));
}

test.runTests([
  () => test.resetWTS({
    users: {
      marge: {},
      lisa: {},
    }
  }),
  testListSites,
  testListObjects,
  testListRoot,
]);
