import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { fetchPreviewAsDoc, getAsDoc } from "@mod-webhare_testsuite/js/whfs";

async function testBreadCrumbs() {
  const testSiteRoot: string = (await test.getTestSiteJS()).webRoot!;

  let parsed = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/index.rtd");
  let breadcrumbs = test.extractSchemaOrgData(parsed.doc).filter(_ => _["@type"] === "BreadcrumbList");

  test.eq(1, breadcrumbs.length);
  // There should be only one entry with the site's url and the root folder's name
  test.eq([
    {
      "@type": "ListItem",
      url: testSiteRoot,
      name: "webhare_testsuite.testsitejs",
    },
  ], breadcrumbs[0].itemListElement);

  parsed = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage");
  breadcrumbs = test.extractSchemaOrgData(parsed.doc).filter(_ => _["@type"] === "BreadcrumbList");
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
      siteName: "WebHare Testsite",
      type: "website",
      url: /\/TestPages\/StaticPage\/$/
    }, og);
  }

  {
    const parsed = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/metadata");
    const og = test.extractOpenGraphData(parsed.doc);
    test.eq({
      //url: /\/TestPages\/metadata\/$/, //TODO dynamic pages should probably get a canonical URL too
      siteName: "WebHare Testsite",
      type: "website",
      image: {
        url: "https://beta.webhare.net/testpages/metadata/testimage.jpg",
        alt: "Test image",
      }
    }, og, "Opengraph data should have been merged (siteName/type was global)");
  }
}

test.runTests([
  testBreadCrumbs,
  testOpenGraph
]);
