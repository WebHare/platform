import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as services from "@webhare/services";
import type { ReadableStream } from "node:stream/web";
import { WebHareBlob } from "@webhare/services";
import type { Rotation } from "@webhare/services/src/descriptor";
import { getFetchResourceCacheCleanups, getCachePaths, readCacheMetadata } from "@webhare/services/src/fetchresource";
import { storeDiskFile } from "@webhare/system-tools";
import { rm } from "node:fs/promises";

async function testResolve() {
  test.throws(/without a base path/, () => services.resolveResource("", "lib/emtpydesign.whlib"));

  test.eq({ namespace: "mod", module: "a", subpath: "b/c/d" }, services.parseResourcePath("mod::a/b/c/d"));
  test.eq({ namespace: "mod", module: "a", subpath: "b/c/d", hash: "#e" }, services.parseResourcePath("mod::a/b/c/d#e"));
  test.eq({ namespace: "storage", module: "a", subpath: "b/c/d", hash: "#e" }, services.parseResourcePath("storage::a/b/c/d#e"));
  test.eq({ namespace: "site", subpath: "a/b/c/d", hash: "#e" }, services.parseResourcePath("site::a/b/c/d#e"));
  test.eq(null, services.parseResourcePath("nosuch::a/b/c/d#e"));
  test.eq(null, services.parseResourcePath("/a/b/c/d#e"));

  test.eq("", services.resolveResource("mod::a/b/c/d", ""));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "/e"));
  test.eq("mod::a/b/c/e", services.resolveResource("mod::a/b/c/d", "./e"));
  test.eq("mod::a/b/e", services.resolveResource("mod::a/b/c/d", "../e"));
  test.eq("mod::a/e", services.resolveResource("mod::a/b/c/d", "../../e"));
  test.throws(/tries to escape/, () => services.resolveResource("mod::a/b/c/d", "../../../e"));

  test.eq(true, services.isAbsoluteResource("mod::publisher/designs/emptydesign/"));

  test.eq("mod::publisher/designs/emptydesign/lib/emptydesign.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "lib/emptydesign.whlib"));
  test.eq("mod::publisher/designs/emptydesign/lib/", services.resolveResource("mod::publisher/designs/emptydesign/", "lib/"));
  test.eq("mod::publisher/api.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "/api.whlib"));

  test.eq("site::webhare backend/design/lib/webharebackend.whlib", services.resolveResource("mod::publisher/designs/emptydesign/", "site::webhare backend/design/lib/webharebackend.whlib"));
  test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml", services.resolveResource("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.siteprl", './registrationform.xml'));
  test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor", services.resolveResource("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.siteprl", './registrationform.xml#editor'));

  // TODO do we really want to be able to ignre the missing first path and return a path anyway?
  //      it seems that the base path would often be fixe and the relative path 'external' data
  //      so that we should fail *any* case where the base path is unusable?
  //test.eq("mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor", services.resolveResource("", 'mod::example/webdesigns/ws2016/src/pages/registrationform/registrationform.xml#editor'));

  test.eq("mod::publisher/designs/emptydesign/lib/emptydesign.witty", services.resolveResource("mod::publisher/designs/emptydesign/lib/emptydesign.whlib", "emptydesign.witty"));
  // MakeAbsoluteResourcePath would return "mod::publisher/designs/emptydesign/" but without the slash makes more sense? you're referring to that directory
  test.eq("mod::publisher/designs/emptydesign", services.resolveResource("mod::publisher/designs/emptydesign/siteprl.prl", "."));

  test.eq("site::lelibel/design/customleft.siteprl", services.resolveResource("site::lelibel/design/", "/design/customleft.siteprl"));
  /* TODO unlikely for wh:: support to return
  test.eq("wh::a/", services.resolveResource("wh::a/b.whlib", "."));
  test.eq("wh::b/la/", services.resolveResource("wh::b/", "la/"));
  test.eq("wh::b/la/", services.resolveResource("wh::b/c.whlib", "la/"));
  test.eq("wh::c.whlib", services.resolveResource("wh::a/b.whlib", "/c.whlib"));
  test.eq("wh::c.whlib", services.resolveResource("wh::a/b.whlib", "../c.whlib"));

  await test.throws(/tries to escape/, () => services.resolveResource("wh::a/b.whlib", "../../c.whlib"));
  await test.throws(/tries to escape/, () => services.resolveResource("wh::a.whlib", "../../c.whlib"));
  */
  test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("xx::a/b/c/d", "e"));
  test.throws(/Invalid namespace 'xx'/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "xx::a/b/c/d"));

  test.throws(/tries to escape/, () => services.resolveResource("mod::publisher/designs/emptydesign/", "../../../bla.whlib"));
  test.throws(/tries to escape/, () => services.resolveResource("site::mysite/folder/test.html", "../../bla.html"));
}

async function testPaths() {
  test.assert(services.backendConfig);

  test.eq(services.backendConfig.module.system.root + "lib/database.whlib", services.toFSPath("mod::system/lib/database.whlib"));
  test.eq(services.backendConfig.module.system.root + "scripts/whcommands/reset.whscr", services.toFSPath("mod::system/scripts/whcommands/reset.whscr"));

  //Verify final slashes handling
  test.eq(services.backendConfig.module.system.root, services.toFSPath("mod::system"));
  test.eq(services.backendConfig.module.system.root, services.toFSPath("mod::system/"));
  test.eq(services.backendConfig.module.system.root + "lib", services.toFSPath("mod::system/lib"));
  test.eq(services.backendConfig.module.system.root + "lib/", services.toFSPath("mod::system/lib/"));

  test.eq(services.backendConfig.dataRoot + "storage/system/xyz", services.toFSPath("storage::system/xyz"));
  test.eq(services.backendConfig.dataRoot + "storage/system/xyz/", services.toFSPath("storage::system/xyz/"));
  test.eq(services.backendConfig.dataRoot + "storage/system/", services.toFSPath("storage::system"));

  test.eq(/^https?:.*/, services.backendConfig.backendURL);

  const systempath = services.backendConfig.module.system.root;
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath(systempath + "lib/tests/cluster.whlib"));
  test.throws(/Cannot match filesystem path/, () => services.toResourcePath("/etc"));
  test.eq(null, services.toResourcePath("/etc", { allowUnmatched: true }));

  test.throws(/^Unsupported resource path/, () => services.toFSPath("site::repository/"));
  test.eq(null, services.toFSPath("site::repository/", { allowUnmatched: true }));
}

function testResourceEventMasks() {
  test.eq(["system:modulefolder.mod::system/lib/", "system:moduleupdate.system"], services.getResourceEventMasks("mod::system/lib/database.whlib"));
  test.eq(["system:modulefolder.mod::system/lib/", "system:moduleupdate.system"], services.getResourceEventMasks(services.toFSPath("mod::system/lib/database.whlib")));
  test.eq(["system:modulefolder.mod::system/lib/", "system:moduleupdate.system"], services.getResourceEventMasks(["mod::system/lib/", "mod::system/lib/"]));
  test.eq(["system:modulefolder.mod::system/js/", "system:modulefolder.mod::system/lib/", "system:moduleupdate.system"], services.getResourceEventMasks(new Set(["mod::system/lib/", "mod::system/js/blabla.ts"])));
  test.eq(["system:modulefolder./tmp/"], services.getResourceEventMasks("/tmp/"));
  test.eq(["system:modulefolder./tmp/"], services.getResourceEventMasks("/tmp/vla.txt"));
}

async function readAllFromStream(stream: ReadableStream) {
  const buffers: Buffer[] = [];
  for await (const chunk of stream)
    buffers.push(Buffer.from(chunk));

  return Buffer.concat(buffers).toString('utf8');
}

async function testWebHareBlobs() {
  const emptyblob = WebHareBlob.from("");
  test.eq(0, emptyblob.size);
  test.eq("", await readAllFromStream(await emptyblob.getStream()));
  emptyblob satisfies Blob;

  const helloblob = WebHareBlob.from("Hello, World");
  test.eq(12, helloblob.size);
  test.eq("Hello, World", await readAllFromStream(await helloblob.getStream()));
  test.eq("Hello, World", await readAllFromStream(await helloblob.getStream()), 'verify double readable');

  test.eq("Hello, World", await helloblob.text());

  const bufferblob = WebHareBlob.from(Buffer.from("01020304", "hex"));
  test.eq(4, bufferblob.size);
  test.eq("\x01\x02\x03\x04", await bufferblob.text());

  const diskblob = await WebHareBlob.fromDisk(__dirname + "/data/testfile.txt");
  test.eq(19, diskblob.size);
  test.eq("This is a testfile\n", await diskblob.text());

  //test compatibility with the JS Blob
  const Blob_blob = await WebHareBlob.fromBlob(new Blob(["Hello, ", "World", "\n"]));
  test.eq("Hello, World\n", await Blob_blob.text());

  //test HSVM Compatibility APIs
  test.eq("Hello, World", Buffer.from(helloblob.__getAsSyncUInt8Array()).toString('utf8'));
  test.eq("This is a testfile\n", Buffer.from(diskblob.__getAsSyncUInt8Array()).toString('utf8'));

  //test temporary? compatibility
  test.eq("Hello, World", Buffer.from(await helloblob.arrayBuffer()).toString('utf8'));
  test.eq("This is a testfile\n", Buffer.from(await diskblob.arrayBuffer()).toString('utf8'));

  // Is type handled/copied correctly?
  test.eq("", WebHareBlob.from("Hello, World").type);
  test.eq("text/plain", WebHareBlob.from("Hello, World", { type: "text/plain" }).type);
  test.eq("text/plain", WebHareBlob.from(Buffer.from("Hello, World"), { type: "text/plain" }).type);
  test.eq("text/plain", WebHareBlob.from(new TextEncoder().encode("Hello, World").buffer, { type: "text/plain" }).type);
  test.eq("text/plain", WebHareBlob.from(new DataView(new TextEncoder().encode("Hello, World").buffer), { type: "text/plain" }).type);
  test.eq("text/plain", (await WebHareBlob.fromBlob(new Blob(["Hello, World"], { type: "text/plain" }))).type);
  test.eq("application/pdf", (await WebHareBlob.fromBlob(new Blob(["Hello, World"], { type: "text/plain" }), { type: "application/pdf" })).type);
}

async function testResourceDescriptors() {
  //Test various resource scan options
  {
    const testsitejs = await test.getTestSiteJS();
    const imgEditFile = await testsitejs.openFile("/testpages/imgeditfile.jpeg");
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { sourceFile: imgEditFile.id });
    test.eq(75125, fish.resource.size);
    test.eqPartial({
      mediaType: "application/octet-stream",
      hash: null,
      width: null,
      height: null,
      sourceFile: imgEditFile.id,
    }, fish.getMetaData());

    const clone1 = await fish.clone();
    test.eqPartial({
      mediaType: "application/octet-stream",
      hash: null,
      width: null,
      height: null,
      sourceFile: imgEditFile.id,
    }, clone1.getMetaData());

    const clone2 = await clone1.clone({ getImageMetadata: true });
    test.eqPartial({
      mediaType: "image/png",
      hash: null,
      width: 385,
      height: 236
    }, clone2.getMetaData());

    const clone3 = await clone2.clone({ getHash: true });
    test.eqPartial({
      mediaType: "image/png",
      hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
      width: 385,
      height: 236
    }, clone3.getMetaData());

    const clone4 = await fish.clone({ fileName: "x.png", mediaType: "image/png" });
    test.eqPartial({
      mediaType: "image/png",
      hash: null,
      width: null,
      height: null,
      fileName: "x.png",
      sourceFile: imgEditFile.id,
    }, clone4.getMetaData());

    await test.throws(/Cannot update the mediaType/, () => fish.clone({ mediaType: "image/png", getDominantColor: true }));

    const exp = await clone3.export();
    test.eq(`site::${testsitejs.name}${imgEditFile.sitePath}`, exp.sourceFile);
    const expImported = await services.ResourceDescriptor.import(exp);
    test.eq(exp, await expImported.export());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { mediaType: "image/png" });
    test.eq(75125, fish.resource.size);
    test.eqPartial({
      mediaType: "image/png",
      hash: null,
      width: null,
      height: null
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true });
    test.eq(75125, fish.resource.size);
    test.eqPartial({
      mediaType: "application/octet-stream",
      hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
      width: null,
      height: null
    }, fish.getMetaData());
  }

  {
    const homersbrain = await services.ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/system/testdata/homersbrain.bmp", { getHash: true, getImageMetadata: true, getDominantColor: true });
    test.eq(921654, homersbrain.resource.size);
    const origMeta = homersbrain.getMetaData();
    test.eqPartial({
      mediaType: "image/x-bmp",
      hash: "TUgOPetpSJcF9d0UDUYOH6lujDWSSNWu0J7FhvJ1EcA",
      width: 640,
      height: 480,
      extension: ".bmp",
      dominantColor: "#080808",
      rotation: 0,
      mirrored: false
    }, homersbrain.getMetaData());

    const exp = await homersbrain.export();
    const expImported = await services.ResourceDescriptor.import(exp);
    test.eq(origMeta, expImported.getMetaData());

    test.throws(/Invalid color format/, () => expImported.dominantColor = "#AAA");
    expImported.dominantColor = null;
    test.eq(null, expImported.dominantColor);
    expImported.dominantColor = "#aaaaaa";
    expImported.refPoint = { x: 1, y: 1 };
    test.eq("#AAAAAA", expImported.dominantColor);

    const exp2 = await expImported.export();
    const expImported2 = await services.ResourceDescriptor.import(exp2);
    test.eq(expImported.getMetaData(), expImported2.getMetaData());
    test.eq("#AAAAAA", expImported2.dominantColor);
    test.eq({ x: 1, y: 1 }, expImported2.refPoint);
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true });
    test.eqPartial({
      mediaType: "image/png",
      hash: null,
      mirrored: false,
      width: 385,
      height: 236,
      rotation: 0,
      dominantColor: null,
      extension: ".png",
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getDominantColor: true });
    test.eqPartial({
      mediaType: "image/png",
      hash: null,
      width: 385, //implied by getDmoinantColor
      height: 236,
      dominantColor: "#080808"
    }, fish.getMetaData());
  }

  {
    const webp = await services.ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.webp", { getImageMetadata: true });
    test.eqPartial({
      mediaType: "image/webp",
      hash: null,
      width: 428,
      height: 284,
      extension: ".webp"
    }, webp.getMetaData());
  }

  {
    const avif = await services.ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.avif", { getImageMetadata: true });
    test.eqPartial({
      mediaType: "image/avif",
      hash: null,
      width: 428,
      height: 284,
      extension: ".avif"
    }, avif.getMetaData());
  }

  {
    const landscape = await services.ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/baselibs/hsengine/data/exif/landscape_7.jpg", { getImageMetadata: true });
    test.eq(140645, landscape.resource.size);
    test.eqPartial({
      mediaType: "image/jpeg",
      hash: null,
      mirrored: true,
      width: 600,
      height: 450,
      rotation: 90 as Rotation,
      dominantColor: null
    }, landscape.getMetaData());
  }

  {
    //We can create a resource from a blob. But that gives us incomplete info:
    const landscapeBlob = await WebHareBlob.fromDisk(services.toFSPath("mod::webhare_testsuite/tests/baselibs/hsengine/data/exif/landscape_7.jpg"));
    const res = new services.ResourceDescriptor(landscapeBlob, { mediaType: "image/jpeg" });
    test.eq("image/jpeg", res.mediaType);
    test.eq(null, res.width);
    test.eq(null, res.sourceFile);

    //using ResourceDescriptor.from will give us the full info (as it has a chance to wait)
    const res2 = await services.ResourceDescriptor.from(landscapeBlob, { getImageMetadata: true, fileName: "my.jpg", sourceFile: 123 });
    test.eq(600, res2.width);
    test.eq("my.jpg", res2.fileName);
    test.eq(123, res2.sourceFile);

    const clone = await res2.clone({ sourceFile: 456 });
    test.eq(123, res2.sourceFile);
    test.eq(456, clone.sourceFile);
    test.eq("my.jpg", clone.fileName);
    test.eq("image/jpeg", clone.mediaType);
    test.eq(600, clone.width);
  }

  // STORY: test filename and mediaType properly used from Blob and File
  {
    const resourceFromBlob = await services.ResourceDescriptor.fromBlob(new Blob(["aa"], { type: "application/pdf" }));
    test.eq("application/pdf", resourceFromBlob.mediaType);
    test.eq(2, resourceFromBlob.resource.size);

    const resourceFromBlob2 = await services.ResourceDescriptor.fromBlob(new Blob(["aa"], { type: "" }));
    test.eq("application/octet-stream", resourceFromBlob2.mediaType);

    const resourceFromFile = await services.ResourceDescriptor.fromBlob(new File(["aa"], "test.pdf", { type: "application/pdf" }));
    test.eq("application/pdf", resourceFromFile.mediaType);
    test.eq("test.pdf", resourceFromFile.fileName);
    test.eq(2, resourceFromFile.resource.size);

    const resourceFromFile2 = await services.ResourceDescriptor.fromBlob(new File(["aa"], "", { type: "" }));
    test.eq("application/octet-stream", resourceFromFile2.mediaType);
    test.eq(null, resourceFromFile2.fileName);
    test.eq(2, resourceFromFile2.resource.size);
  }
}

async function testGIFs() {
  const dummygif = Buffer.from("47494638396101000100800000ffffffffffff21f90401000000002c00000000010001000002024401003b", "hex");
  //TODO decide whether this is really the desired way to deal with in-memory info, and not arraybuffers or views
  const parsedgif = await services.ResourceDescriptor.from(dummygif, { getHash: true, getDominantColor: true });
  test.eq(43, parsedgif.resource.size);
  test.eqPartial({
    mediaType: "image/gif",
    hash: "hy_6nckd_mgbm-gsu0HLzcCYXnerJ-FYPjjYThVDy3Q",
    mirrored: false,
    width: 1,
    height: 1,
    rotation: 0,
    dominantColor: "transparent",
    extension: '.gif'
  }, parsedgif.getMetaData());

  const brokengif = Buffer.from("47494638396101000100800000ffffffffffff21f90401000000002c0000", "hex");
  const brokenparsedgif = await services.ResourceDescriptor.from(brokengif, { getHash: true, getDominantColor: true });
  test.eq(30, brokenparsedgif.resource.size);

  test.eqPartial({
    mediaType: "application/octet-stream",
    hash: "HSYfiL-sB6VV2_nfkPTR_IxepvNXb1oBbJ0rzvrwmgM",
    mirrored: null,
    width: null,
    height: null,
    rotation: null,
    dominantColor: null
  }, brokenparsedgif.getMetaData());
}

async function testFetchResource() {
  const testsitejs = await test.getTestSiteJS();
  const snowbeagle = await testsitejs.openFile("photoalbum/snowbeagle.jpg");
  const fetched = await services.fetchResource(snowbeagle.link!);
  test.eq(17191, fetched.resource.size);
  test.eq("snowbeagle.jpg", fetched.fileName, "should extract nice file name from URL: " + snowbeagle.link!);

  const locinfo = await getCachePaths(snowbeagle.link!);
  const meta = await readCacheMetadata(locinfo.metaloc);

  //Verify the cleanup will also eliminate stray files later
  const straypath = locinfo.cachedir + ".stray";
  await storeDiskFile(straypath, Buffer.from("stray"), { overwrite: true });

  //wait a tick and refetch, verify whether it looks like we got the same resource back from the cache (no metadata update)
  await test.sleep(2); //wait a tick! can't image us beating the clock though
  const fetched2 = await services.fetchResource(snowbeagle.link!);
  const meta2 = await readCacheMetadata(locinfo.metaloc);
  test.eq(17191, fetched2.resource.size);
  test.eq(meta.lastDownload, meta2.lastDownload);


  { //Test cleanup. shouldn't be seen by normal 7 days cleanup
    const toClean = new Set<string>;
    await getFetchResourceCacheCleanups(7 * 86400_0000, name => void toClean.add(name));
    test.assert(!toClean.has(locinfo.diskloc));
    test.assert(!toClean.has(locinfo.metaloc));
    test.assert(toClean.has(straypath)); //a stray file is deleted on sight
  }


  { //Should be seen if we cleanup time to 1 msec
    const toClean = new Set<string>;
    await getFetchResourceCacheCleanups(1, name => void toClean.add(name));
    test.assert(toClean.has(locinfo.diskloc));
    test.assert(toClean.has(locinfo.metaloc));
    test.assert(toClean.has(straypath));
  }

  { //Remove the meta file, this should also allow the data file to be offered for deletion
    await rm(locinfo.metaloc);

    const toClean = new Set<string>;
    await getFetchResourceCacheCleanups(1, name => void toClean.add(name));
    test.assert(toClean.has(locinfo.diskloc));
  }
}

test.runTests(
  [
    testResolve,
    testPaths,
    testResourceEventMasks,
    testWebHareBlobs,
    testResourceDescriptors,
    testGIFs,
    testFetchResource,
  ]);
