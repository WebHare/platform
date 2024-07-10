import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import * as crypto from "node:crypto";
import { getTestSiteHS, getTestSiteJS, getTestSiteTemp, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";
import { openFile, openFileOrFolder } from "@webhare/whfs";
import { ResourceDescriptor } from "@webhare/services";

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
  test.assert(whfs.isValidName(".doc"), "'dot' files are okay");

  await test.throws(/No such site 'webhare_testsuite.nosuchsite'/, whfs.openSite("webhare_testsuite.nosuchsite"));
  test.eq(null, await whfs.openSite("webhare_testsuite.nosuchsite", { allowMissing: true }));

  const testsite = await getTestSiteHS();
  const testsitejs = await getTestSiteJS();
  test.assert(testsite, "We need the HS testsite to exist");
  test.assert(testsitejs, "We need the JS testsite to exist");
  test.eq(/^https?:.*/, testsite.webRoot);
  test.eq(testsite.id, (await whfs.openSite(testsite.id)).id);
  //verify listSites and exact typing of response value
  test.eq({ id: testsite.id, name: "webhare_testsuite.testsite" }, (await whfs.listSites()).find(_ => _.name === "webhare_testsuite.testsite"));
  test.eq({ id: testsite.id, name: "webhare_testsuite.testsite" }, (await whfs.listSites([])).find(_ => _.name === "webhare_testsuite.testsite"));

  const testSites = (await whfs.listSites(["webDesign", "webFeatures"])).filter(_ => _.name === "webhare_testsuite.testsite" || _.name === "webhare_testsuite.testsitejs").toSorted((a, b) => a.name.localeCompare(b.name));
  test.eq([
    { id: testsite.id, name: "webhare_testsuite.testsite", webDesign: "webhare_testsuite:basetest", webFeatures: null },
    { id: testsitejs.id, name: "webhare_testsuite.testsitejs", webDesign: "webhare_testsuite:basetestjs", webFeatures: ["platform:identityprovider"] }
  ], testSites);

  await test.throws(/No such file .*nosuchfile/, testsite.openFile("testpages/nosuchfile"));
  test.eq(null, await testsite.openFile("testpages/nosuchfile", { allowMissing: true }));

  await test.throws(/Type mismatch/, testsite.openFile("testpages/"));

  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile);
  test.assert(markdownfile.isFile);
  test.eq(testsite.webRoot + "TestPages/markdownpage/", markdownfile.link);
  test.eq("/TestPages/markdownpage", markdownfile.sitePath);
  test.eq(testsite.id, markdownfile.parentSite);

  test.eq(true, (await openFileOrFolder(markdownfile.id)).isFile);

  const rootfolder = await testsite.openFolder(".");
  test.eq(testsite.id, rootfolder.id);
  test.assert(rootfolder.indexDoc);
  test.eq("index.rtd", (await whfs.openFile(rootfolder.indexDoc)).name);

  test.assert(markdownfile.parent);
  const testpagesfolder = await whfs.openFolder(markdownfile.parent);
  test.eq("TestPages", testpagesfolder.name);
  test.eq(null, testpagesfolder.indexDoc);

  const list = await testpagesfolder.list(["parent", "publish"]);
  test.assert(list.length > 5, "should be a lot of files/folders in this list");
  test.eq([
    {
      id: markdownfile.id,
      name: markdownfile.name,
      isFolder: false,
      parent: testpagesfolder.id,
      publish: true
    }
  ], list.filter(e => e.name === markdownfile.name));
  test.eqPartial({ publish: false }, list.find(e => e.name === "unpublished"));
  for (let i = 0; i < list.length - 1; ++i)
    test.assert(list[i].name < list[i + 1].name, "List should be sorted on name");

  const list2 = await testpagesfolder.list(["type", "sitePath", "whfsPath"]);
  test.eqPartial({
    type: "http://www.webhare.net/xmlns/publisher/richdocumentfile",
    sitePath: '/TestPages/staticpage-ps-af',
    whfsPath: '/webhare-tests/webhare_testsuite.testsite/TestPages/staticpage-ps-af'
  }, list2.find(_ => _.name === 'staticpage-ps-af'));

  test.eq({ id: markdownfile.id, name: markdownfile.name, isFolder: false }, (await testpagesfolder.list()).find(e => e.name === markdownfile.name), "Verify list() works without any keys");
  test.eq({ id: markdownfile.id, name: markdownfile.name, isFolder: false }, (await testpagesfolder.list([])).find(e => e.name === markdownfile.name), "Verify list() works with empty keys");

  //Compare other opening routes
  test.eq(markdownfile.id, (await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage")).id);
  test.eq(markdownfile.id, (await whfs.openFile(markdownfile.id)).id);
  test.eq(markdownfile.id, (await whfs.openFile("whfs::" + markdownfile.whfsPath)).id);
  test.eq(true, (await whfs.openFile(markdownfile.id)).publish);

  test.eq("", (await whfs.openFolder("/webhare-tests/")).sitePath);
  test.eq('/', (await whfs.openFolder("site::webhare_testsuite.testsite")).sitePath);
  test.eq(testpagesfolder.id, (await testsite.openFolder("testpages")).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder("site::webhare_testsuite.testsite/testpages")).id);
  test.eq('/TestPages/', (await whfs.openFolder("site::webhare_testsuite.testsite/testpages")).sitePath);
  test.eq(testpagesfolder.id, (await whfs.openFolder("site::webhare_testsuite.testsite/testpages/")).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder(testpagesfolder.id)).id);
  test.eq(testpagesfolder.id, (await whfs.openFolder("whfs::" + testpagesfolder.whfsPath)).id);

  //Read a 'fs_objects.data' cell
  const wittytestfile = await testpagesfolder.openFile("wittytest.witty");
  test.eq(11, await wittytestfile.data.resource.size);
  test.eq(`[wittytest]`, await wittytestfile.data.resource.text());

  test.eq(testpagesfolder.id, (await wittytestfile.openParent()).id);
  test.eq(testpagesfolder.parent!, (await testpagesfolder.openParent()).id);

  const imgfile = await testpagesfolder.openFile("imgeditfile.jpeg");
  test.eq('0hMX4RpiWulvvNdfeF92ErsUAWebk7Kx59bsflO3BIw', imgfile.data.hash);
  test.eq('image/jpeg', imgfile.data.mediaType);
  test.eq('.jpg', imgfile.data.extension);
  test.eq(1024, imgfile.data.width);
  test.eq(768, imgfile.data.height);
  test.eq(0, imgfile.data.rotation);
  test.eq(false, imgfile.data.mirrored);
  test.eq(null, imgfile.data.refPoint);
  test.eq("#EFF0EB", imgfile.data.dominantColor);
  test.eq("imgeditfile.jpeg", imgfile.data.fileName);

  // Get the sha256 of the file
  const hashSum = crypto.createHash('sha256');
  hashSum.update(Buffer.from(await imgfile.data.resource.arrayBuffer()));
  test.eq('0hMX4RpiWulvvNdfeF92ErsUAWebk7Kx59bsflO3BIw', hashSum.digest('base64url'));

  const tmpfolder = await testsite.openFolder("tmp");

  await whdb.beginWork();
  const newFile = await tmpfolder.createFile("testfile", { type: "http://www.webhare.net/xmlns/publisher/markdownfile", title: "My MD File", data: null });
  const openNewFile = await tmpfolder.openFile("testfile");
  test.eq(newFile.id, openNewFile.id);
  test.eq("testfile", newFile.name);
  test.eq("My MD File", newFile.title);

  const goldFish = await tmpfolder.createFile("goldfish.png", { data: await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png") });
  test.eq("image/png", goldFish.data.mediaType);
  test.eq(385, goldFish.data.width);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldFish.data.hash);
  test.eq("goldfish.png", goldFish.data.fileName);

  await goldFish.update({ data: await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg") });
  const openedGoldFish = await openFile(goldFish.id);
  test.eq("image/jpeg", openedGoldFish.data.mediaType);
  test.eq(428, openedGoldFish.data.width);
  test.eq('eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw', openedGoldFish.data.hash);
  test.eq("goldfish.png", openedGoldFish.data.fileName, "a file's resource name is fixed to its fsobject");

  const newFile2 = await tmpfolder.createFile("testfile2.txt", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile", title: "My plain File", data: await ResourceDescriptor.from("This is a test") });
  const openNewFile2 = await openFile(newFile2.id);
  test.eq("This is a test", await openNewFile2.data.resource.text());
  test.eq("testfile2.txt", openNewFile2.data.fileName);
  test.eq("text/plain", openNewFile2.data.mediaType);

  await openNewFile2.update({ data: await ResourceDescriptor.from("Updated text") });
  test.eq("Updated text", await openNewFile2.data.resource.text());
  test.eq("testfile2.txt", openNewFile2.data.fileName);
  test.eq("Updated text", await (await openFile(newFile2.id)).data.resource.text());
  test.eq("text/plain", await (await openFile(newFile2.id)).data.mediaType);

  //FIXME test proper unwrapped into 'wrapped' of metadata associated with the resource descriptor. eg if given we should also copy/preserve refpoints

  await newFile.delete();
  await newFile2.recycle();
  test.eq(null, await tmpfolder.openFile("testfile", { allowMissing: true }));
  test.eq(null, await tmpfolder.openFile("testfile2.txt", { allowMissing: true }));
  await test.throws(/No such file/, openFile(newFile.id));
  await test.throws(/No such file.*recycle/, openFile(newFile2.id));
  test.eq(null, await openFile(newFile.id, { allowMissing: true }));
  test.eq(null, await openFile(newFile2.id, { allowMissing: true }));
  test.eq(null, await openFile(newFile.id, { allowMissing: true, allowHistoric: false }));
  test.eq(null, await openFile(newFile2.id, { allowMissing: true, allowHistoric: false }));
  test.eq(null, await openFile(newFile.id, { allowMissing: true, allowHistoric: true }));
  test.eq(newFile2.id, (await openFile(newFile2.id, { allowHistoric: true })).id);

  const docxje = await tmpfolder.createFile("empty.docx", { data: await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/system/testdata/empty.docx") /* FIXME, publish: false*/ });
  test.eq("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docxje.data.mediaType);

  const ensuredfolder = await tmpfolder.ensureFolder("sub1");
  test.eq("sub1", ensuredfolder.name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1")).name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1", {})).name);
  const ensuredfolder2 = await tmpfolder.ensureFolder("sub1");
  test.eq(ensuredfolder.id, ensuredfolder2.id);

  const ensuredfile = await tmpfolder.ensureFile("file1", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
  test.eq(ensuredfile.creationDate, ensuredfile.modificationDate);

  const now = new Date;
  await test.sleep(1);//ensure clock progresses.
  const ensuredfile2 = await tmpfolder.ensureFile("file1", { data: await ResourceDescriptor.from("Updated text") });
  test.assert(ensuredfile2.modificationDate > now, "Modification date should be updated");

  await whdb.commitWork();
}

async function testGenerateUniqueName() {
  const tmpfolder = await getTestSiteTemp();

  await whdb.beginWork();
  const uniquenamefolder = await tmpfolder.createFolder("uniquenames");
  const l256a = "aaaa".repeat(256 / 4);
  const r240a = l256a.substring(0, 236) + ".doc";
  const r240b = l256a.substring(0, 235) + "-9.doc";
  const r240c = l256a.substring(0, 235) + "-9.txt";

  const fileids: Record<string, number> = {};
  for (const name of [
    "a.tar.gz",
    "a.doc",
    "a-2.tar.gz",
    "b.doc",
    "b-2.doc",
    "b-4.doc",
    "b-5.doc",
    "d--2.doc",
    "e-0.doc",
    "f-a.doc",
    "g-1.doc",
    "h.doc",
    "h-1.doc",
    "unnamed",
    r240b,
    r240c,
    "webhare.txt",
    ".doc"
  ])
    fileids[name] = (await uniquenamefolder.createFile(name)).id;
  await whdb.commitWork();

  test.eq("a-3.tar.gz", await uniquenamefolder.generateName("a.tar.gz"));
  test.eq("a-3.tar.gz", await uniquenamefolder.generateName("^a.tar.gz"));
  test.eq("a-3.tar.gz", await uniquenamefolder.generateName("a-1.tar.gz"));
  test.eq("a-3.tar.gz", await uniquenamefolder.generateName("a-1.tar.gz"));
  test.eq("a-2.tar.gz", await uniquenamefolder.generateName("a-2.tar.gz", { ignoreObject: fileids["a-2.tar.gz"] }));
  test.eq("a-3.tar.gz", await uniquenamefolder.generateName("a-3.tar.gz"));
  test.eq("a-4.tar.gz", await uniquenamefolder.generateName("a-4.tar.gz"));
  test.eq("a-2.doc", await uniquenamefolder.generateName("a.doc"));
  test.eq("a-2.doc", await uniquenamefolder.generateName("a-1.doc"));
  test.eq("a-2.doc", await uniquenamefolder.generateName("a-2.doc"));
  test.eq("a-3.doc", await uniquenamefolder.generateName("a-3.doc"));
  test.eq("b-3.doc", await uniquenamefolder.generateName("b.doc"));
  test.eq("b-3.doc", await uniquenamefolder.generateName("b-1.doc"));
  test.eq("b-3.doc", await uniquenamefolder.generateName("b-2.doc"));
  test.eq("b-3.doc", await uniquenamefolder.generateName("b-3.doc"));
  test.eq("b-6.doc", await uniquenamefolder.generateName("b-4.doc"));
  test.eq("b-6.doc", await uniquenamefolder.generateName("b-5.doc"));
  test.eq("b-6.doc", await uniquenamefolder.generateName("b-6.doc"));
  test.eq("c.doc", await uniquenamefolder.generateName("c.doc"));
  test.eq("c-2.doc", await uniquenamefolder.generateName("c--2.doc"));
  test.eq("c.doc", await uniquenamefolder.generateName("c--1.doc")); //this is a weird corner case either way..
  test.eq("d.doc", await uniquenamefolder.generateName("d--1.doc"));
  test.eq("d-0.doc", await uniquenamefolder.generateName("d-0.doc"));
  test.eq("e-0-2.doc", await uniquenamefolder.generateName("e-0.doc"));
  test.eq("f-a-2.doc", await uniquenamefolder.generateName("f-a.doc"));
  test.eq("g.doc", await uniquenamefolder.generateName("g.doc"));
  test.eq("g.doc", await uniquenamefolder.generateName("g-1.doc"));
  test.eq("h-2.doc", await uniquenamefolder.generateName("h.doc"));
  test.eq("h-2.doc", await uniquenamefolder.generateName("h-1.doc"));
  test.eq("unnamed-2", await uniquenamefolder.generateName("unnamed"));
  test.eq("doc", await uniquenamefolder.generateName(".doc"));
  test.eq(r240a, await uniquenamefolder.generateName(r240a));
  test.eq("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.doc", await uniquenamefolder.generateName("a" + r240a));
  test.eq("webhare.doc", await uniquenamefolder.generateName(r240b)); // overload of aa...aa (10).doc (241 chars)
  test.eq("webhare-2.txt", await uniquenamefolder.generateName(r240c)); // overload of aa...aa (10).doc (241 chars)
  test.eq("fail.doc", await uniquenamefolder.generateName("fail?.doc"));
  test.eq("fail.txt", await uniquenamefolder.generateName("fail?.txt"));
  test.eq("index.html", await uniquenamefolder.generateName("^index.html"));

  test.eq("bachelor-colloquium-owk-jacqueline-aalberssamenwerking-in-collaborative-data-teams.-onderzoek-naar-typen-van-samenwerking-en-bevorderende-en-belemmerende-factoren-in-data-teams-ter-verbetering-van-het-onderwijs-en-nog-een-heel-lang-verhaa"
    , await uniquenamefolder.generateName("bachelor-colloquium-owk-jacqueline-aalberssamenwerking-in-collaborative-data-teams. -onderzoek naar typen van samenwerking en bevorderende en belemmerende factoren in data teams ter verbetering van het onderwijs- en nog een heel lang verhaal dat we misschien niet willen weten omdat het zo lang is"));

}

test.run([
  testSuiteCleanup,
  testWHFS,
  testGenerateUniqueName
]);
