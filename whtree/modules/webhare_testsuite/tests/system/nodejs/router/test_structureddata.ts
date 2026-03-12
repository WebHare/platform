import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import { openFile } from "@webhare/whfs";

async function testBreadCrumbs() {
  const testSiteRoot: string = (await test.getTestSiteJS()).webRoot!;
  const staticPageDoc = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const req = await fetch(await staticPageDoc.getPreviewLink());
  const doc = parseDocAsXML(await req.text(), "text/html");
  const breadcrumbs = test.extractSchemaOrgData(doc).filter(_ => _["@type"] === "BreadcrumbList");

  test.eq(1, breadcrumbs.length);
  test.eq([
    {
      "@type": "ListItem",
      url: testSiteRoot,
      name: "webhare_testsuite.testsitejs",
    }, {
      "@type": "ListItem",
      name: "TestPages"
      //has no index and thus no url
    }, {
      "@type": "ListItem",
      url: testSiteRoot + "TestPages/StaticPage/",
      name: "StaticPage"
    }
  ], breadcrumbs[0].itemListElement);

}

test.runTests([testBreadCrumbs]);
