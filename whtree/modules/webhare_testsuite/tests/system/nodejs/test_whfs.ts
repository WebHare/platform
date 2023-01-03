import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";

async function testWHFS() {
  await test.throws(/No such site 'webhare_testsuite.nosuchsite'/, whfs.openSite("webhare_testsuite.nosuchsite"));
  test.eq(null, await whfs.openSite("webhare_testsuite.nosuchsite", { allowMissing: true }));

  const testsite = await whfs.openSite("webhare_testsuite.testsite");
  test.assert(testsite, "We need the testsite to exist");
  test.eqMatch(/^https?:.*/, testsite.webroot);
  test.eq(testsite.id, (await whfs.openSite(testsite.id)).id);

  await test.throws(/No such file .*nosuchfile/, testsite.openFile("testpages/nosuchfile"));
  test.eq(null, await testsite.openFile("testpages/nosuchfile", { allowMissing: true }));

  await test.throws(/Type mismatch/, testsite.openFile("testpages/"));

  const markdownfile = await testsite.openFile("testpages/markdownpage");
  test.assert(markdownfile);
  test.assert(markdownfile.isFile);
}

test.run([testWHFS]);
