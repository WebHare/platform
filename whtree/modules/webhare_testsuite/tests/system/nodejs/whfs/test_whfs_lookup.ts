import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { backendConfig, ResourceDescriptor, WebHareBlob } from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { PublishedFlag_StripExtension } from "@webhare/whfs/src/support";
import { maxDateTime } from "@webhare/hscompat";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_whfsid_webharebackend, whwebserverconfig_rescuewebserverid } from "@mod-system/js/internal/webhareconstants";
import { getRescueOrigin } from "@mod-system/js/internal/configuration";
import { getBasePort } from "@webhare/services/src/config";
import { getPostfixAfterDecodedPrefix } from "@webhare/whfs/src/lookupurl";

function testGetPostfixAfterDecodedPrefix() {
  test.eq("hello", getPostfixAfterDecodedPrefix("/%F0%9F%98%80/hello", "/😀/"));
  test.eq(null, getPostfixAfterDecodedPrefix("/%F0%9F%98%81/hello", "/😀/"));
  test.eq("hello%F0", getPostfixAfterDecodedPrefix("/%F0%9F%98%80/hello%F0", "/😀/"));
  test.eq("%E6%97%A5%E6%9C%AC/test", getPostfixAfterDecodedPrefix("/prefix/%E6%97%A5%E6%9C%AC/test", "/prefix/"));
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
  test.eq("", lookupresult.append);

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
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/"));
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

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
  test.eq("subsite/testfolder/", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsite/testfolder/"), { matchProduction: true });
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsite/"), { matchProduction: true });
  test.eq(root.id, lookupresult.site);
  test.eq(root.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL("https://www.example.com/subsit%65/t%65stfolder/"), { matchProduction: true });
  test.eq(root.id, lookupresult.site);
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

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
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html%C1%AC"));
  test.eq({ folder: null, file: null, site: lookupresult.site, webServer: root.outputWeb, append: "testfolder/test.html%C1%AC" }, lookupresult);

  // test with ignored extension extension
  const testfile2 = await testfolder.createFile('test-ignoreext.rtd', { /*published: PublishedFlag_StripExtension, */type: "platform:filetypes.richdocument" });
  await whdb.db<PlatformDB>().updateTable("system.fs_objects").set({ published: PublishedFlag_StripExtension }).where("id", "=", testfile2.id).execute();
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test-ignoreext.rtd"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile2.id, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test-ignoreext"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile2.id, lookupresult.file);
  test.eq("", lookupresult.append);

  const testIgnoreAmpFile = await testfolder.createFile('test&ignore-amp', { type: "platform:filetypes.richdocument" });
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test&ignore-amp")); //& is not a separator before ?, so should just match no file at all
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testIgnoreAmpFile.id, lookupresult.file);
  test.eq("", lookupresult.append);

  // test with umlauts
  const testfileUmlaut = await testfolder.createFile('täst-ümlaut.html', { publish: true });
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/t%C3%A4st-%C3%BCmlaut.html"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfileUmlaut.id, lookupresult.file);
  test.eq("", lookupresult.append);

  // file of folder should be the indexdoc, 0 if not no indexdoc
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("", lookupresult.append);

  const testfile3 = await testfolder.createFile('index.html', { publish: false }); // auto indexdoc
  testfolder = await whfs.openFolder(testfolder.id);
  test.eq(testfile3.id, testfolder.indexDoc);
  test.eq("", lookupresult.append);

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
  test.eq("#jo", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html#jo"), { ifPublished: true });
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("#jo", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test_unpublished.html#jo"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile_unpublished.id, lookupresult.file);
  test.eq("#jo", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test_unpublished.html#jo"), { ifPublished: true });
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(null, lookupresult.file);
  test.eq("test_unpublished.html#jo", lookupresult.append);

  // parameters ignored?
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html?param"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("?param", lookupresult.append);

  // NOTE: ignoring HS edge case where params start with '&' - URL() doesn't recognize that either

  // !part ignored?
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/!ignored/test.html?param"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("?param", lookupresult.append);

  // ! terminates
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/!/test.html/"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile3.id, lookupresult.file); // should go to indexdoc of testfolder, 'test.html' must be ignored.
  test.eq("!/test.html/", lookupresult.append);

  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html/!/ignored"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("/!/ignored", lookupresult.append);

  // invalid encoding in the append
  lookupresult = await whfs.lookupURL(new URL(root.webRoot + "testfolder/test.html/!/ignored%C0"));
  test.eq(testfolder.id, lookupresult.folder);
  test.eq(testfile.id, lookupresult.file);
  test.eq("/!/ignored%C0", lookupresult.append);

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

  testfile = await rootfolder.createFile("def.rtd", { type: "platform:filetypes.richdocument", publish: true });
  test.assert(testfile.link);
  test.assert(!testfile.link.includes(".rtd")); //shouldn't contain .rtd anymore, given our strip code
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
  testGetPostfixAfterDecodedPrefix,
  testLookupWithoutConfig,
  testLookup,
]);
