import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import * as crypto from "node:crypto";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";

async function testWHFS() {
  test.assert(!whfs.isValidName("^file"));
  test.assert(!whfs.isValidName("!file"));
  test.assert(!whfs.isValidName(" ^file"));
  test.assert(!whfs.isValidName(" !file"));
  test.assert(!whfs.isValidName("fi|le"));
  test.assert(whfs.isValidName("_^file"));
  test.assert(whfs.isValidName("_!file"));
  test.assert(!whfs.isValidName("a/b"));
  test.assert(whfs.isValidName("a/b", { allowSlashes: true }));
  test.assert(!whfs.isValidName("a\\b"));
  test.assert(!whfs.isValidName("a\\b", { allowSlashes: true }));
  test.assert(!whfs.isValidName("\r"));
  test.assert(!whfs.isValidName("\u0000"));
  test.assert(!whfs.isValidName("\u0001"));

  await test.throws(/No such site 'webhare_testsuite.nosuchsite'/, whfs.openSite("webhare_testsuite.nosuchsite"));
  test.eq(null, await whfs.openSite("webhare_testsuite.nosuchsite", { allowMissing: true }));

  const testsite = await whfs.openSite("webhare_testsuite.testsite");
  test.assert(testsite, "We need the testsite to exist");
  test.eq(/^https?:.*/, testsite.webRoot);
  test.eq(testsite.id, (await whfs.openSite(testsite.id)).id);
  test.eq(testsite.id, (await whfs.listSites()).find(_ => _.name == "webhare_testsuite.testsite")?.id);

  await test.throws(/No such file .*nosuchfile/, testsite.openFile("testpages/nosuchfile"));
  test.eq(null, await testsite.openFile("testpages/nosuchfile", { allowMissing: true }));

  await test.throws(/Type mismatch/, testsite.openFile("testpages/"));

  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile);
  test.assert(markdownfile.isFile);
  test.eq(testsite.webRoot + "TestPages/markdownpage/", markdownfile.link);
  test.eq("/TestPages/markdownpage", markdownfile.fullPath);
  test.eq(testsite.id, markdownfile.parentSite);

  const rootfolder = await testsite.openFolder(".");
  test.eq(testsite.id, rootfolder.id);
  test.assert(rootfolder.indexDoc);
  test.eq("index.rtd", (await whfs.openFile(rootfolder.indexDoc)).name);

  test.assert(markdownfile.parent);
  const testpagesfolder = await whfs.openFolder(markdownfile.parent);
  test.eq("TestPages", testpagesfolder.name);
  test.eq(null, testpagesfolder.indexDoc);

  const list = await testpagesfolder.list(["parent"]);
  test.assert(list.length > 5, "should be a lot of files/folders in this list");
  test.eq([
    {
      id: markdownfile.id,
      name: markdownfile.name,
      isFolder: false,
      parent: testpagesfolder.id,
    }
  ], list.filter(e => e.name == markdownfile.name));
  for (let i = 0; i < list.length - 1; ++i)
    test.assert(list[i].name < list[i + 1].name, "List should be sorted on name");

  const list2 = await testpagesfolder.list(["type"]);
  test.eq("http://www.webhare.net/xmlns/publisher/richdocumentfile", list2.find(_ => _.name === 'staticpage-ps-af')?.type);

  //Compare other opening routes
  test.eq(markdownfile.id, (await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage")).id);
  test.eq(markdownfile.id, (await whfs.openFile(markdownfile.id)).id);
  test.eq(markdownfile.id, (await whfs.openFile("whfs::" + markdownfile.whfsPath)).id);

  test.eq(testpagesfolder.id, (await testsite.openFolder("testpages")).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder("site::webhare_testsuite.testsite/testpages")).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder("site::webhare_testsuite.testsite/testpages/")).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder(testpagesfolder.id)).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder("whfs::" + testpagesfolder.whfsPath)).id);

  //Read a 'fs_objects.data' cell
  const wittytestfile = await testpagesfolder.openFile("wittytest.witty");
  test.eq(11, await wittytestfile.data.size);
  test.eq(`[wittytest]`, await wittytestfile.data.text());

  const imgfile = await testpagesfolder.openFile("imgeditfile.jpeg");
  test.eq('0hMX4RpiWulvvNdfeF92ErsUAWebk7Kx59bsflO3BIw', imgfile.data.hash);
  test.eq('image/jpeg', imgfile.data.mimeType);
  test.eq('.jpg', imgfile.data.extension);
  test.eq(1024, imgfile.data.width);
  test.eq(768, imgfile.data.height);
  test.eq(0, imgfile.data.rotation);
  test.eq(false, imgfile.data.mirrored);
  test.eq(null, imgfile.data.refPoint);
  test.eq("#EFF0EB", imgfile.data.dominantColor);
  test.eq(null, imgfile.data.fileName); //TODO not set? should perhaps match the original upload name?

  // Get the sha256 of the file
  const hashSum = crypto.createHash('sha256');
  hashSum.update(Buffer.from(await imgfile.data.arrayBuffer()));
  test.eq('0hMX4RpiWulvvNdfeF92ErsUAWebk7Kx59bsflO3BIw', hashSum.digest('base64url'));

  const tmpfolder = await testsite.openFolder("tmp");

  await whdb.beginWork();
  const newfile = await tmpfolder.createFile("testfile", { type: "http://www.webhare.net/xmlns/publisher/markdownfile", title: "My MD File" });
  const newfile2 = await tmpfolder.openFile("testfile");
  test.eq(newfile.id, newfile2.id);
  test.eq("testfile", newfile.name);
  test.eq("My MD File", newfile.title);

  await newfile.delete();
  test.eq(null, await tmpfolder.openFile("testfile", { allowMissing: true }));

  const ensuredfolder = await tmpfolder.ensureFolder("sub1");
  test.eq("sub1", ensuredfolder.name);
  const ensuredfolder2 = await tmpfolder.ensureFolder("sub1");
  test.eq(ensuredfolder.id, ensuredfolder2.id);

  const ensuredfile = await tmpfolder.ensureFile("file1");
  const ensuredfile2 = await tmpfolder.ensureFile("file1");
  test.eq(ensuredfile.id, ensuredfile2.id);

  await whdb.commitWork();
}

async function testSiteProfiles() {
  const markdownfile = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  test.eq("http://www.webhare.net/xmlns/publisher/markdownfile", markdownfile.type.namespace);

  const publicationsettings = await (await getApplyTesterForObject(markdownfile)).getWebDesignInfo();
  test.eq("mod::webhare_testsuite/webdesigns/basetest/lib/basetest.whlib#BaseTestDesign", publicationsettings.objectname);
}

test.run([
  testWHFS,
  testSiteProfiles
]);
