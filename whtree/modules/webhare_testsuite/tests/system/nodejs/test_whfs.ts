import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import * as services from "@webhare/services";

async function testWHFS() {
  await test.throws(/No such site 'webhare_testsuite.nosuchsite'/, whfs.openSite("webhare_testsuite.nosuchsite"));
  test.eq(null, await whfs.openSite("webhare_testsuite.nosuchsite", { allowMissing: true }));

  const testsite = await whfs.openSite("webhare_testsuite.testsite");
  test.assert(testsite, "We need the testsite to exist");
  test.eqMatch(/^https?:.*/, testsite.webroot);
  test.eq(testsite.id, (await whfs.openSite(testsite.id)).id);
  test.eq(testsite.id, (await whfs.listSites()).find(_ => _.name == "webhare_testsuite.testsite")?.id);

  await test.throws(/No such file .*nosuchfile/, testsite.openFile("testpages/nosuchfile"));
  test.eq(null, await testsite.openFile("testpages/nosuchfile", { allowMissing: true }));

  await test.throws(/Type mismatch/, testsite.openFile("testpages/"));

  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile);
  test.assert(markdownfile.isfile);
  test.eq(testsite.webroot + "TestPages/markdownpage/", markdownfile.link);

  //Compare other opening routes
  test.eq(markdownfile.id, (await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage")).id);
  test.eq(markdownfile.id, (await whfs.openFile(markdownfile.id)).id);
  test.eq(markdownfile.id, (await whfs.openFile("whfs::" + markdownfile.whfspath)).id);
}

async function testSiteProfiles() {
  await services.ready();
  const markdownfile = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  test.eq("http://www.webhare.net/xmlns/publisher/markdownfile", markdownfile.type.namespace);
}

test.run([testWHFS, testSiteProfiles]);
