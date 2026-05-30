import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import * as crypto from "node:crypto";
import { openFile, openFileOrFolder, openFolder } from "@webhare/whfs";
import { IntExtLink, ResourceDescriptor } from "@webhare/services";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_whfsid_private } from "@mod-system/js/internal/webhareconstants";

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

  await test.throws(/No such file .*nosuchfile/, testsite.openFile("testpages/nosuchfile"));
  test.eq(null, await testsite.openFile("testpages/nosuchfile", { allowMissing: true }));

  await test.throws(/Type mismatch/, testsite.openFile("testpages/"));

  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile);
  test.assert(markdownfile.isFile);
  test.eq(testsite.webRoot + "TestPages/markdownpage/", markdownfile.link);
  test.eq("/TestPages/markdownpage", markdownfile.sitePath);
  test.eq(testsite.id, markdownfile.parentSite);
  test.eq([`system:whfs.folder.${markdownfile.parent}`], markdownfile.getEventMasks());
  test.eq([`system:whfs-history.folder.${markdownfile.parent}`, `publisher:publication.folder.${markdownfile.parent}`], markdownfile.getEventMasks(["history", "publication"]));

  test.eq(true, (await openFileOrFolder(markdownfile.id)).isFile);

  const rootfolder = await testsite.openFolder(".");
  test.eq(testsite.id, rootfolder.id);
  test.assert(rootfolder.indexDoc);
  test.eq("index.rtd", (await whfs.openFile(rootfolder.indexDoc)).name);

  test.assert(markdownfile.parent);
  const testpagesfolder = await whfs.openFolder(markdownfile.parent);
  test.eq("TestPages", testpagesfolder.name);
  test.eq(null, testpagesfolder.indexDoc);
  test.eq([`system:whfs.folder.${testpagesfolder.id}`], testpagesfolder.getEventMasks());
  test.eq([`system:whfs-history.folder.${testpagesfolder.id}`, `publisher:publication.folder.${testpagesfolder.id}`], testpagesfolder.getEventMasks(["history", "publication"]));

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
  test.eq(null, imgfile.data.refPoint);
  test.eq("#E8E8E8", imgfile.data.dominantColor, "Was #EFF0EB with HareScript reset.whscr");
  test.eq("imgeditfile.jpeg", imgfile.data.fileName);

  // Get the sha256 of the file
  const hashSum = crypto.createHash('sha256');
  hashSum.update(Buffer.from(await imgfile.data.resource.arrayBuffer()));
  test.eq('0hMX4RpiWulvvNdfeF92ErsUAWebk7Kx59bsflO3BIw', hashSum.digest('base64url'));

  const tmpfolder = await testsite.openFolder("tmp");

  await whdb.beginWork();
  const newFile = await tmpfolder.createFile("testfile", { type: "platform:filetypes.markdown", title: "My MD File", data: null });
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
  test.eq(test.wellKnownHashes.snowbeagleJPG, openedGoldFish.data.hash);
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

  //verify we properly write rotated images metadata
  const portrait6 = await tmpfolder.createFile("portrait6.jpg", { data: await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/baselibs/hsengine/data/exif/portrait_6.jpg"), publish: true });
  test.eq(450, portrait6.data.width);
  test.eq(600, portrait6.data.height);
  test.eq(test.wellKnownHashes.portrait6, portrait6.data.hash);

  const newFile2 = await tmpfolder.createFile("testfile2.txt", { type: "platform:filetypes.plaintext", title: "My plain File", data: await ResourceDescriptor.from("This is a test") });
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

  const ensuredfolder = await tmpfolder.ensureFolder("sub1");
  test.eq("sub1", ensuredfolder.name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1")).name);
  test.eq("sub1", (await tmpfolder.ensureFolder("sub1", {})).name);
  test.eq("platform:foldertypes.default", ensuredfolder.type);
  const ensuredfolder2 = await tmpfolder.ensureFolder("sub1");
  test.eq(ensuredfolder.id, ensuredfolder2.id);

  //test auto index doc setting
  test.eq(null, ensuredfolder.indexDoc);
  const setCreated = Temporal.Now.instant().subtract({ seconds: 10 }).round({ smallestUnit: "second" });
  const setModified = Temporal.Now.instant().subtract({ seconds: 5 }).round({ smallestUnit: "second" });
  const newindex = await ensuredfolder.createFile("index.html", { created: setCreated, modified: setModified });
  test.eq(newindex.id, ensuredfolder.indexDoc);
  test.eq(newindex.id, (await whfs.openFolder(ensuredfolder.id)).indexDoc);
  test.eq(setCreated, newindex.created);
  test.eq(setModified, newindex.modified);

  const setCreated2 = Temporal.Now.instant().subtract({ seconds: 8 }).round({ smallestUnit: "second" });
  const setModified2 = Temporal.Now.instant().subtract({ seconds: 6 }).round({ smallestUnit: "second" });
  await newindex.update({ created: setCreated2, modified: setModified2 } as whfs.UpdateFileMetadata);
  test.eq(setCreated, (await whfs.openFile(newindex.id)).created, "Attempt to update 'created' will have been ignored");
  test.eq(setModified2, (await whfs.openFile(newindex.id)).modified);

  //@ts-expect-error TS recognizes the type as invalid but it should still work for legacy support
  const ensuredfile = await tmpfolder.ensureFile("file1", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
  test.eq(ensuredfile.created, ensuredfile.modified);
  test.eq("platform:filetypes.plaintext", ensuredfile.type);

  const now = Temporal.Now.instant();
  await test.sleep(1);//ensure clock progresses.
  const ensuredfile2 = await tmpfolder.ensureFile("file1", { data: await ResourceDescriptor.from("Updated text") });
  test.assert(ensuredfile2.modified.epochMilliseconds > now.epochMilliseconds, "Modification date should be updated");
  test.eq(ensuredfile2.created, ensuredfile.created, "Creation date should be unchanged");

  await whdb.commitWork();

  //Test a regression when invalid parent references causes whfsPath to return 'null' instead of a string
  await whdb.beginWork();
  await whdb.db<PlatformDB>().updateTable("system.fs_objects").set("parent", -1).where("id", "=", ensuredfile.id).execute();
  const badFileInfo = await openFile(ensuredfile.id);
  test.eq("", badFileInfo.whfsPath); //not sure what it should be, but 'null' is bad
  await whdb.rollbackWork();

  //Test future indexdoc support (TODO deferred pre-commit validation whether the indexdoc is actually a file in the right folder?)
  await whdb.beginWork();
  const futureIndexId = await whfs.nextWHFSObjectId();
  const subFolderWithFutureIndex = await tmpfolder.createFolder("subfolder-future-index", { indexDoc: futureIndexId });
  const futureIndexFile = await subFolderWithFutureIndex.createFile("index", { id: futureIndexId, type: "platform:filetypes.richdocument" });
  await whdb.commitWork();
  test.eq(futureIndexFile.id, (await openFolder(subFolderWithFutureIndex.id)).indexDoc);
}

async function testLinkTypes() {
  await whdb.beginWork();
  const tmpfolder = await test.getTestSiteHSTemp();
  const goldFish = await tmpfolder.openFile("goldfish.png");
  const goldFish2 = await tmpfolder.openFile("goldfish2.png");

  //test CLink
  await test.throws(/must be an internalLink /, () => tmpfolder.createFile("bad-clink", { type: "platform:filetypes.contentlink", target: new IntExtLink("http://example.com") }));
  await test.throws(/must be an internalLink /, () => tmpfolder.createFile("bad-clink", { type: "platform:filetypes.contentlink", target: new IntExtLink(goldFish.id, { append: "#vis" }) }));
  await test.throws(/Type.*does not support a target/, () => tmpfolder.createFile("bad-clink", { type: "platform:filetypes.plaintext", target: new IntExtLink(goldFish.id) }));
  await tmpfolder.createFile("not-a-clink", { type: "platform:filetypes.plaintext", target: null }); //null target is fine for non-clinks

  const goldFish_clink = await tmpfolder.createFile("goldfish-clink", { type: "platform:filetypes.contentlink", target: new IntExtLink(goldFish.id), publish: true });
  test.eq(goldFish.id, goldFish_clink.target?.internalLink);

  await goldFish_clink.update({ target: new IntExtLink(goldFish2.id) });
  test.eq(goldFish2.id, goldFish_clink.target?.internalLink);

  await goldFish_clink.update({ target: null });
  test.eq(null, goldFish_clink.target);

  //test IntLink
  const goldFish_intlink = await tmpfolder.createFile("goldfish-intlink", { type: "platform:filetypes.internallink", target: new IntExtLink(goldFish.id), publish: true });
  test.eq(goldFish.id, goldFish_intlink.target?.internalLink);
  test.eq("platform:filetypes.internallink", goldFish_intlink.type);

  await test.throws(/An internallink can't have an externalLink target/, () => tmpfolder.createFile("bad-intlink", { type: "platform:filetypes.internallink", target: new IntExtLink("http://example.com") }));
  await test.throws(/An externallink can't have an internalLink target/, () => tmpfolder.createFile("bad-intlink", { type: "platform:filetypes.externallink", target: new IntExtLink(goldFish.id) }));

  //But if you create without setting any type, its automatically an internallink or externallink
  const goldFish_autolink1 = await tmpfolder.createFile("goldfish-autolink1", { target: new IntExtLink(goldFish.id) });
  test.eq(goldFish.id, goldFish_autolink1.target?.internalLink);
  test.eq("platform:filetypes.internallink", goldFish_autolink1.type);

  await goldFish_intlink.update({ target: new IntExtLink(goldFish2.id, { append: "#vis" }) });
  test.eq(goldFish2.id, goldFish_intlink.target?.internalLink);
  test.eq("#vis", goldFish_intlink.target?.append);
  test.eq("platform:filetypes.internallink", goldFish_intlink.type);

  // No auto-switch if you're explictily updating using the wrong type
  await test.throws(/An internallink can't have an externalLink target/, () => goldFish_intlink.update({ target: new IntExtLink("http://example.com"), type: "platform:filetypes.internallink" }));

  await goldFish_intlink.update({ target: new IntExtLink("http://example.com/goudvis") });
  test.eq("platform:filetypes.externallink", goldFish_intlink.type);
  test.eq("http://example.com/goudvis", goldFish_intlink.target?.externalLink);

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

test.runTests([
  test.resetWTS,
  testWHFS,
  testLinkTypes,
  testGenerateUniqueName,
]);
