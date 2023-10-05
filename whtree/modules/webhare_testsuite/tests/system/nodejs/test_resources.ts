import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { ReadableStream } from "node:stream/web";
import { WebHareBlob } from "@webhare/services";
import { Rotation } from "@webhare/services/src/descriptor";

async function testResolve() {
  test.throws(/without a base path/, () => services.resolveResource("", "lib/emtpydesign.whlib"));

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
  test.assert(services.config);

  test.eq(services.config.module.system.root + "lib/database.whlib", services.toFSPath("mod::system/lib/database.whlib"));
  test.eq(services.config.module.system.root + "scripts/whcommands/reset.whscr", services.toFSPath("mod::system/scripts/whcommands/reset.whscr"));

  //Verify final slashes handling
  test.eq(services.config.module.system.root, services.toFSPath("mod::system"));
  test.eq(services.config.module.system.root, services.toFSPath("mod::system/"));
  test.eq(services.config.module.system.root + "lib", services.toFSPath("mod::system/lib"));
  test.eq(services.config.module.system.root + "lib/", services.toFSPath("mod::system/lib/"));

  test.eq(services.config.dataroot + "storage/system/xyz", services.toFSPath("storage::system/xyz"));
  test.eq(services.config.dataroot + "storage/system/xyz/", services.toFSPath("storage::system/xyz/"));
  test.eq(services.config.dataroot + "storage/system/", services.toFSPath("storage::system"));

  test.eq(/^https?:.*/, services.config.backendURL);

  const systempath = services.config.module.system.root;
  test.eq("mod::system/lib/tests/cluster.whlib", services.toResourcePath(systempath + "lib/tests/cluster.whlib"));
  test.throws(/Cannot match filesystem path/, () => services.toResourcePath("/etc"));
  test.eq(null, services.toResourcePath("/etc", { allowUnmatched: true }));

  test.throws(/^Unsupported resource path/, () => services.toFSPath("site::repository/"));
  test.eq(null, services.toFSPath("site::repository/", { allowUnmatched: true }));
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

  //test HSVM Compatibility APIs
  test.eq("Hello, World", Buffer.from(helloblob.__getAsSyncUInt8Array()).toString('utf8'));
  test.eq("This is a testfile\n", Buffer.from(diskblob.__getAsSyncUInt8Array()).toString('utf8'));

  //test temporary? compatibility
  test.eq("Hello, World", Buffer.from(await helloblob.arrayBuffer()).toString('utf8'));
  test.eq("This is a testfile\n", Buffer.from(await diskblob.arrayBuffer()).toString('utf8'));
}

async function testResourceDescriptors() {
  //Test various resource scan options
  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
    test.eq(75125, fish.resource.size);
    test.eqProps({
      mediaType: "application/octet-stream",
      hash: null,
      width: null,
      height: null
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { mediaType: "image/png" });
    test.eq(75125, fish.resource.size);
    test.eqProps({
      mediaType: "image/png",
      hash: null,
      width: null,
      height: null
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true });
    test.eq(75125, fish.resource.size);
    test.eqProps({
      mediaType: "application/octet-stream",
      hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
      width: null,
      height: null
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true });
    test.eqProps({
      mediaType: "image/png",
      hash: null,
      mirrored: null,
      width: 385,
      height: 236,
      rotation: null,
      dominantColor: null
    }, fish.getMetaData());
  }

  {
    const fish = await services.ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getDominantColor: true });
    test.eqProps({
      mediaType: "image/png",
      hash: null,
      width: 385, //implied by getDmoinantColor
      height: 236,
      dominantColor: "#080808"
    }, fish.getMetaData());
  }

  {
    const landscape = await services.ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/baselibs/hsengine/data/exif/landscape_7.jpg", { getImageMetadata: true });
    test.eq(140645, landscape.resource.size);
    test.eqProps({
      mediaType: "image/jpeg",
      hash: null,
      mirrored: true,
      width: 600,
      height: 450,
      rotation: 90 as Rotation,
      dominantColor: null
    }, landscape.getMetaData());
  }
}

async function testGIFs() {
  const dummygif = Buffer.from("47494638396101000100800000ffffffffffff21f90401000000002c00000000010001000002024401003b", "hex");
  //TODO decide whether this is really the desired way to deal with in-memory info, and not arraybuffers or views
  const parsedgif = await services.ResourceDescriptor.from(dummygif, { getHash: true, getDominantColor: true });
  test.eq(43, parsedgif.resource.size);
  test.eqProps({
    mediaType: "image/gif",
    hash: "hy_6nckd_mgbm-gsu0HLzcCYXnerJ-FYPjjYThVDy3Q",
    mirrored: null,
    width: 1,
    height: 1,
    rotation: null,
    dominantColor: "transparent"
  }, parsedgif.getMetaData());

  const brokengif = Buffer.from("47494638396101000100800000ffffffffffff21f90401000000002c0000", "hex");
  const brokenparsedgif = await services.ResourceDescriptor.from(brokengif, { getHash: true, getDominantColor: true });
  test.eq(30, brokenparsedgif.resource.size);

  test.eqProps({
    mediaType: "application/octet-stream",
    hash: "HSYfiL-sB6VV2_nfkPTR_IxepvNXb1oBbJ0rzvrwmgM",
    mirrored: null,
    width: null,
    height: null,
    rotation: null,
    dominantColor: null
  }, brokenparsedgif.getMetaData());
}

test.run(
  [
    testResolve,
    testPaths,
    testWebHareBlobs,
    testResourceDescriptors,
    testGIFs
  ]);
