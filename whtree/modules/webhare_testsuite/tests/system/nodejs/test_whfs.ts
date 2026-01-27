import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import * as crypto from "node:crypto";
import { openFile, openFileOrFolder } from "@webhare/whfs";
import { backendConfig, ResourceDescriptor, WebHareBlob } from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { PublishedFlag_StripExtension } from "@webhare/whfs/src/support";
import { maxDateTime } from "@webhare/hscompat";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_whfsid_private, whconstant_whfsid_webharebackend, whwebserverconfig_rescuewebserverid } from "@mod-system/js/internal/webhareconstants";
import { getRescueOrigin } from "@mod-system/js/internal/configuration";
import { getBasePort } from "@webhare/services/src/config";
import { isTemporalInstant } from "@webhare/std";

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

  const privatefolder = await whfs.openFolder("/webhare-private/platform");
  test.eq("platform", privatefolder.name);
  test.eq("/webhare-private/platform/", privatefolder.whfsPath);
  test.eq(null, privatefolder.parentSite);
  test.eq(null, privatefolder.link);
  test.eq(null, privatefolder.sitePath);
  test.eq(null, await privatefolder.getBaseURL());

  await test.throws(/No such site 'webhare_testsuite.nosuchsite'/, whfs.openSite("webhare_testsuite.nosuchsite"));
  test.eq(null, await whfs.openSite("webhare_testsuite.nosuchsite", { allowMissing: true }));

  await test.throws(/Cannot open root folder/, whfs.openFolder(0));
  await test.throws(/Cannot open root folder/, whfs.openFolder('/'));
  test.eq(0, (await whfs.openFolder('/', { allowRoot: true })).id);
  test.eq(0, (await whfs.openFolder(0, { allowRoot: true })).id);

  const root = await whfs.openFolder('/', { allowRoot: true });
  test.eqPartial({ id: whconstant_whfsid_private }, (await root.list()).find(_ => _.name === "webhare-private"));
  test.eq(/^2.*/, root.modified.toString(), "should be a sane modificationdate");

  const testsite = await test.getTestSiteHS();
  const testsitejs = await test.getTestSiteJS();
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

  //Compare other opening routes
  test.eq(markdownfile.id, (await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage")).id);
  test.eq(markdownfile.id, (await whfs.openFile(markdownfile.id)).id);
  test.eq(markdownfile.id, (await whfs.openFile("whfs::" + markdownfile.whfsPath)).id);
  test.eq(true, (await whfs.openFile(markdownfile.id)).publish);

  test.eq(null, (await whfs.openFolder("/webhare-tests/")).sitePath);
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
  test.eq(false, newFile.isPinned);
  test.eq(false, newFile.isUnlisted);
  test.eq(newFile.id, openNewFile.id);
  test.eq("testfile", newFile.name);
  test.eq("My MD File", newFile.title);
  test.eq(false, newFile.publish);
  test.eq(null, newFile.firstPublish);
  test.eq(null, newFile.contentModified);

  await newFile.update({ publish: true });
  const openNewFile_state2 = await openFile(newFile.id);
  test.assert(openNewFile_state2.modified.epochMilliseconds > openNewFile.modified.epochMilliseconds);
  test.eq(openNewFile_state2.modified, openNewFile_state2.firstPublish);
  test.eq(openNewFile_state2.modified, openNewFile_state2.contentModified);
  test.eq(true, openNewFile_state2.publish);

  const goldFishId = await whfs.nextWHFSObjectId();
  const goldFish = await tmpfolder.createFile("goldfish.png", { id: goldFishId, data: await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png"), publish: true, isPinned: true, isUnlisted: true });
  test.eq(true, goldFish.isPinned);
  test.eq(true, goldFish.isUnlisted);
  test.eq(goldFishId, goldFish.id);
  test.eq("image/png", goldFish.data.mediaType);
  test.eq(385, goldFish.data.width);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldFish.data.hash);
  test.eq("goldfish.png", goldFish.data.fileName);
  test.eq(true, goldFish.publish);
  test.eq(goldFish.created, goldFish.firstPublish);
  test.eq(goldFish.created, goldFish.contentModified);

  await goldFish.update({ data: await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg"), isPinned: false, isUnlisted: false });
  const openedGoldFish = await openFile(goldFish.id);
  test.eq(false, openedGoldFish.isPinned);
  test.eq(false, openedGoldFish.isUnlisted);
  test.eq("image/jpeg", openedGoldFish.data.mediaType);
  test.eq(428, openedGoldFish.data.width);
  test.eq('eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw', openedGoldFish.data.hash);
  test.eq("goldfish.png", openedGoldFish.data.fileName, "a file's resource name is fixed to its fsobject");

  const goldFish2 = await tmpfolder.createFile("goldfish2.png", {
    data: await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png"),
    publish: true,
    firstPublish: new Date(2020, 1, 1).toTemporalInstant(),
    contentModified: new Date(2021, 1, 1).toTemporalInstant()
  });
  test.eq(new Date(2021, 1, 1).toTemporalInstant(), goldFish2.contentModified);
  test.eq(new Date(2020, 1, 1).toTemporalInstant(), goldFish2.firstPublish);
  await goldFish2.update({ data: await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg"), firstPublish: new Date(2022, 1, 1).toTemporalInstant() });
  await goldFish2.update({ data: await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg"), contentModified: new Date(2023, 1, 1).toTemporalInstant() });
  test.eq(new Date(2022, 1, 1).toTemporalInstant(), goldFish2.firstPublish);
  test.eq(new Date(2023, 1, 1).toTemporalInstant(), goldFish2.contentModified);

  const newFile2 = await tmpfolder.createFile("testfile2.txt", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile", title: "My plain File", data: await ResourceDescriptor.from("This is a test") });
  const openNewFile2 = await openFile(newFile2.id);
  test.eq("This is a test", await openNewFile2.data.resource.text());
  test.eq("testfile2.txt", openNewFile2.data.fileName);
  test.eq("text/plain", openNewFile2.data.mediaType);
  test.eq(false, newFile2.publish);
  test.eq(newFile2.created, newFile2.contentModified);
  test.eq(null, newFile2.firstPublish);

  await openNewFile2.update({ data: await ResourceDescriptor.from("Updated text") });
  test.eq("Updated text", await openNewFile2.data.resource.text());
  test.eq("testfile2.txt", openNewFile2.data.fileName);
  test.eq("Updated text", await (await openFile(newFile2.id)).data.resource.text());
  test.eq("text/plain", (await openFile(newFile2.id)).data.mediaType);
  test.assert(openNewFile2.modified.epochMilliseconds > newFile2.modified.epochMilliseconds);
  test.eq(openNewFile2.modified, openNewFile2.contentModified);

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

  //test auto index doc setting
  test.eq(null, tmpfolder.indexDoc);
  const newindex = await tmpfolder.createFile("index.html");
  test.eq(newindex.id, tmpfolder.indexDoc);
  test.eq(newindex.id, (await whfs.openFolder(tmpfolder.id)).indexDoc);

  const ensuredfolder = await tmpfolder.ensureFolder("sub1");
  test.eq("sub1", ensuredfolder.name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1")).name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1", {})).name);
  test.eq("platform:foldertypes.default", ensuredfolder.type);
  const ensuredfolder2 = await tmpfolder.ensureFolder("sub1");
  test.eq(ensuredfolder.id, ensuredfolder2.id);

  const ensuredfile = await tmpfolder.ensureFile("file1", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
  test.eq(ensuredfile.created, ensuredfile.modified);
  test.eq("platform:filetypes.plaintext", ensuredfile.type);

  const now = Temporal.Now.instant();
  await test.sleep(1);//ensure clock progresses.
  const ensuredfile2 = await tmpfolder.ensureFile("file1", { data: await ResourceDescriptor.from("Updated text") });
  test.assert(ensuredfile2.modified.epochMilliseconds > now.epochMilliseconds, "Modification date should be updated");
  test.eq(ensuredfile2.created, ensuredfile.created, "Creation date should be unchanged");

  await whdb.commitWork();
}

async function testGenerateUniqueName() {
  const tmpfolder = await test.getTestSiteJSTemp();

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

  test.eq("bachelor-colloquium-owk-jacqueline-aalberssamenwerking-in-collaborative-data-teams.-onderzoek-naar-typen-van-samenwerking-en-bevorderende-en-belemmerende-factoren-in-data-teams-ter-verbetering-van-het-onderwijs-en-nog-een-heel-lang-verhaa",
    await uniquenamefolder.generateName("bachelor-colloquium-owk-jacqueline-aalberssamenwerking-in-collaborative-data-teams. -onderzoek naar typen van samenwerking en bevorderende en belemmerende factoren in data teams ter verbetering van het onderwijs- en nog een heel lang verhaal dat we misschien niet willen weten omdat het zo lang is"));
}

async function testRescuePort() {
  test.eqPartial({
    site: whconstant_whfsid_webharebackend,
    folder: whconstant_whfsid_webharebackend,
  }, await whfs.lookupURL(new URL(`http://127.0.0.1:${getBasePort()}/`)));

  test.eqPartial({
    site: whconstant_whfsid_webharebackend,
    folder: whconstant_whfsid_webharebackend,
  }, await whfs.lookupURL(new URL(`http://127.0.0.1:${getBasePort()}/`), { clientWebServer: whwebserverconfig_rescuewebserverid }));
}

async function testLookupWithoutConfig() { //mirrors TestRescueWithoutWebservers
  await whdb.beginWork();
  await whdb.db<PlatformDB>().deleteFrom("system.webservers").execute();
  await testRescuePort();
  await whdb.rollbackWork();
}

async function testLookup() {
  const testfw = await loadlib("mod::system/lib/testframework.whlib").RunTestframework([]);

  const lookuptest = await testfw.CreateWebserverPort({ outputserver: true, virtualhosts: ["test-lookup.example.net"], aliases: ["test-alias.example.net", "*plein.example.net"] });
  const lookuptest2 = await testfw.CreateWebserverPort({});

  await whdb.beginWork();
  await testfw.SetupTestWebsite(WebHareBlob.from(""));
  const testsiteobj = await testfw.GetTestSite();

  //Test with http://127.0.0.1:39124/ URLs...
  let root = await whfs.openSite("webhare_testsuite.site");
  test.assert(root.webRoot);

  test.assert(root.outputWeb);
  test.assert(root.outputFolder);
  let lookupresult = await whfs.lookupURL(new URL(root.webRoot));
  test.eq(root.id, lookupresult.site);
  test.eq(root.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  const rootfolder = await root.openFolder("/");
  let testfolder = await rootfolder.createFolder("testfolder");

  //Now test with virtualhosted URLs
  await testsiteobj.SetPrimaryOutput(lookuptest.webservers[0].id, "/");

  root = await whfs.openSite("webhare_testsuite.site");
  test.assert(root.webRoot);

  await testRescuePort();

  lookupresult = await whfs.lookupURL(new URL(root.webRoot));
  test.eq(lookuptest.webservers[0].id, lookupresult.webServer);
  test.eq(root.id, lookupresult.site, root.webRoot + " did not return the proper site");
  test.eq(root.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/"));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  await whfs.openType("http://www.webhare.net/xmlns/publisher/sitesettings").set(root.id, { productionurl: "https://www.example.com/subsite/" });
  await whfs.whfsType("platform:web.config").set(root.id, { comments: "comment" });
  test.eq([
    {
      fsObject: root.id,
      namespace: "http://www.webhare.net/xmlns/publisher/sitesettings",
      scopedType: "platform:web.sitesettings",
      clone: "onCopy",
      workflow: false,
      orphan: false,
    }, {
      fsObject: root.id,
      namespace: "platform:web.config",
      scopedType: "platform:web.config",
      clone: "onArchive",
      workflow: false,
      orphan: false,
    }
  ], await whfs.listInstances([root.id]));

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsite/testfolder/"));
  test.eq(null, lookupresult.site);
  test.eq(null, lookupresult.folder);
  test.eq(null, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsite/testfolder/"), { matchProduction: true });
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsite/"), { matchProduction: true });
  test.eq(root.id, lookupresult.site);
  test.eq(root.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  for (const shouldwork of ["test-alias.example.net", "test-alias.example.net", "test-lookup.example.net", "www.trampolineplein.example.net", "www.plein.example.net", "plein.example.net"]) {
    const testurl = root.webRoot.replace("test-lookup.example.net", shouldwork);
    lookupresult = await whfs.lookupURL(new URL(testurl));
    test.eq(root.id, lookupresult.site, testurl + " should work");
  }

  for (const shouldfail of ["mytest-alias.example.net"]) {
    const testurl = root.webRoot.replace("test-lookup.example.net", shouldfail);
    lookupresult = await whfs.lookupURL(new URL(testurl));
    test.eq(null, lookupresult.site, testurl + " should fail");
  }

  //any virtualhosted site should accept https versions too (ADDME: test: but only if that port# is actually being listened to by a virtualhost?)
  lookupresult = await whfs.lookupURL(new URL(root.webRoot.replace('http:', 'https:')));

  test.eq(root.id, lookupresult.site);
  test.eq(root.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  let testfile = await testfolder.createFile("test.html", { publish: true });
  const testfile_unpublished = await testfolder.createFile("test_unpublished.html", { publish: false });

  lookupresult = await whfs.lookupURL(new URL(testfile.link!));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html%C1%AC"));
  test.eq({ folder: null, file: null, site: null, webServer: root.outputWeb }, lookupresult);

  // test with ignored extension extension
  const testfile2 = await testfolder.createFile('test-ignoreext.doc', { /*published: PublishedFlag_StripExtension, */type: "http://www.webhare.net/xmlns/publisher/mswordfile" });
  await whdb.db<PlatformDB>().updateTable("system.fs_objects").set({ published: PublishedFlag_StripExtension }).where("id", "=", testfile2.id).execute();
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test-ignoreext.doc"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile2.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test-ignoreext"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile2.id, lookupresult.file);

  // file of folder should be the indexdoc, 0 if not no indexdoc
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  const testfile3 = await testfolder.createFile('index.html', { publish: false }); // auto indexdoc
  testfolder = await whfs.openFolder(testfolder.id);
  test.eq(testfile3.id, testfolder.indexDoc);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile3.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"), { ifPublished: true });
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file, "index.html isn't published!");

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile3.id, lookupresult.file);

  // hash ignored
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html#jo"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html#jo"), { ifPublished: true });
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test_unpublished.html#jo"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile_unpublished.id, lookupresult.file);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test_unpublished.html#jo"), { ifPublished: true });
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);

  // parameters ignored?
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html?param"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  // NOTE: ignoring HS edge case where params start with '&' - URL() doesn't recognize that either

  // !part ignored?
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/!ignored/test.html?param"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  // ! terminates
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/!/test.html/"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile3.id, lookupresult.file); // should go to indexdoc of testfolder, 'test.html' must be ignored.

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html/!/ignored"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);

  //Test through preview link
  const previewlink = await loadlib("mod::publisher/lib/internal/tollium-helpers.whlib").createPreviewLink(maxDateTime, "", lookupresult.file, lookupresult.file);
  lookupresult = await whfs.lookupURL(new URL(previewlink));
  test.eq(testfile.id, lookupresult.file, "whfs.lookupURL did not crack the preview link");
  lookupresult = await whfs.lookupURL(new URL(previewlink + "&bladiebla"));
  test.eq(testfile.id, lookupresult.file, "whfs.lookupURL did not crack the preview link");
  lookupresult = await whfs.lookupURL(new URL(previewlink + "#bladiebla"));
  test.eq(testfile.id, lookupresult.file, "whfs.lookupURL did not crack the preview link");

  await whfs.openType("http://www.webhare.net/xmlns/beta/test").set(testfile.id, {
    arraytest: [
      {
        blobcell: await ResourceDescriptor.from("1", { fileName: "1.txt", mediaType: "text/plain" })
      },
      {
        blobcell: await ResourceDescriptor.from("2", { fileName: "2.zip", mediaType: "application/zip" })
      }
    ]
  });

  const testdata = await whfs.openType("http://www.webhare.net/xmlns/beta/test").get(testfile.id) as any;
  lookupresult = await whfs.lookupURL(new URL(testdata.arraytest[1].blobcell.toLink({ baseURL: root.webRoot })));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);

  test.eq(testfile.id, lookupresult.file, "Looking up testdata.arraytest[1].blobcell.link");

  testfile = await rootfolder.createFile("def.doc", { type: "http://www.webhare.net/xmlns/publisher/mswordfile", publish: true });
  test.assert(testfile.link);
  test.assert(!testfile.link.includes(".doc")); //shouldn't contain .doc anymore, given our strip code
  lookupresult = await whfs.lookupURL(new URL(testfile.link));
  test.eq(testfile.id, lookupresult.file);

  //Regression
  lookupresult = await whfs.lookupURL(new URL(new URL("/tollium_todd/download/iJTSMjXoVvWNNXrggqeq3g/", testfile.link).toString()));
  test.eq(testfile.parentSite, lookupresult.site);
  test.eq(lookuptest.webservers[0].id, lookupresult.webServer);
  lookupresult = await whfs.lookupURL(new URL(new URL("/.system/dl/ec~AQLrIyEAgpvLAiE2CwCjrcACOgas/yt-g.png", testfile.link).toString()));
  test.eq(testfile.parentSite, lookupresult.site);
  test.eq(lookuptest.webservers[0].id, lookupresult.webServer);

  lookupresult = await whfs.lookupURL(new URL("c:\\windows\\win.ini"));
  test.eq(null, lookupresult.site);

  const webharetestsuitesite = await whfs.openSite("webhare_testsuite.testsite");
  lookupresult = await whfs.lookupURL(new URL(new URL("/testoutput/webhare_testsuite.testsite/testpages/formtest/", backendConfig.backendURL).toString()));
  test.eq(webharetestsuitesite.id, lookupresult.site);
  test.eq(webharetestsuitesite.outputWeb, lookupresult.webServer);

  //Now test with website hosted under an alternative backend url
  await testsiteobj.SetPrimaryOutput(lookuptest2.webservers[0].id, "/testoutput/mytestsite");
  root = await whfs.openSite("webhare_testsuite.site");
  test.eq(lookuptest2.webservers[0].url + "testoutput/mytestsite/", root.webRoot);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile3.id, lookupresult.file);

  await whdb.rollbackWork();

  //it's important for lookupURL new URL(to work with the rescue port. even if, or especially if, the backend site is not connected to a UR)L
  await whdb.beginWork(); //we'll be rolling back!
  await whdb.db<PlatformDB>().deleteFrom("system.webservers").execute();
  test.eqPartial({ site: whconstant_whfsid_webharebackend }, await whfs.lookupURL(new URL(getRescueOrigin()), { clientWebServer: whwebserverconfig_rescuewebserverid }));
  await whdb.rollbackWork();
}

test.runTests([
  test.resetWTS,
  testWHFS,
  testGenerateUniqueName,
  testLookupWithoutConfig,
  testLookup
]);
