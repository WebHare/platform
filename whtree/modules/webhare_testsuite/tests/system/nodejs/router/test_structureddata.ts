import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { fetchPreviewAsDoc, getAsDoc } from "@mod-webhare_testsuite/js/whfs";

async function testBreadCrumbs() {
  const testSiteRoot: string = (await test.getTestSiteJS()).webRoot!;
  const parsed = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const breadcrumbs = test.extractSchemaOrgData(parsed.doc).filter(_ => _["@type"] === "BreadcrumbList");

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

  const faq = test.extractSchemaOrgData(parsed.doc).find(_ => _["@type"] === "FAQPage");
  test.eqPartial({
    "mainEntity": [
      {
        "@type": "Question",
        "name": "How to find an apprenticeship?",
      }, {
        "@type": "Question",
        "name": "Whom to contact?",
      }
    ]
  }, faq);
}

async function testOpenGraph() {
  {
    const parsed = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage");
    const og = test.extractOpenGraphData(parsed.doc);
    test.eq({
      url: /\/TestPages\/StaticPage\/$/
    }, og);
  }
}

test.runTests([
  testBreadCrumbs,
  testOpenGraph
]);
