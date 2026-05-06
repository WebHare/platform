import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { fetchAsDoc, fetchPreviewAsDoc, getAsDoc } from "@mod-webhare_testsuite/js/whfs";

async function testBreadCrumbs() {
  const testSiteRoot: string = (await test.getTestSiteJS()).webRoot!;

  let parsed = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/index.rtd");
  let breadcrumbs = test.extractSchemaOrgData(parsed.doc).filter(_ => _["@type"] === "BreadcrumbList");

  test.eq(1, breadcrumbs.length);
  // There should be only one entry with the site's url and the root folder's name
  test.eq([
    {
      "@type": "ListItem",
      item: testSiteRoot,
      name: "webhare_testsuite.testsitejs",
    },
  ], breadcrumbs[0].itemListElement);

  parsed = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage");
  breadcrumbs = test.extractSchemaOrgData(parsed.doc).filter(_ => _["@type"] === "BreadcrumbList");
  test.eq(1, breadcrumbs.length);
  test.eq([
    {
      "@type": "ListItem",
      item: testSiteRoot,
      name: "webhare_testsuite.testsitejs",
    }, {
      "@type": "ListItem",
      name: "TestPages"
      //has no index and thus no url
    }, {
      "@type": "ListItem",
      item: testSiteRoot + "TestPages/StaticPage/",
      name: "StaticPage"
    }
  ], breadcrumbs[0].itemListElement);

  const faq = parsed.schemaOrg.find(_ => _["@type"] === "FAQPage");
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

async function testCustomStructuredData() {
  //HS generated, HS rendered
  {
    const dynamicPage = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/TestPages/dynamicpage");
    const faq = dynamicPage.schemaOrg.find(_ => _["@type"] === "FAQPage");
    test.eqPartial({
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Where is this page's code located?",
          acceptedAnswer: { '@type': 'Answer', text: 'Try basetestpages.whlib#DynamicPage' },
        }
      ]
    }, faq);
  }

  //HS generated, JS rendered (to ensure proper transfer from HS to JS)
  {
    const dynamicPage = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/TestPages/dynamicpage");
    const faq = dynamicPage.schemaOrg.find(_ => _["@type"] === "FAQPage");
    test.eqPartial({
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Where is this page's code located?",
          acceptedAnswer: { '@type': 'Answer', text: 'Try basetestpages.whlib#DynamicPage' },
        }
      ]
    }, faq);
  }
}

async function testOpenGraph() {
  {
    const parsed = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage");
    test.eq({
      siteName: "WebHare Testsite",
      type: "website",
      url: /\/TestPages\/StaticPage\/$/
    }, parsed.openGraph);
  }

  {
    const parsed = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/metadata");
    test.eq({
      //url: /\/TestPages\/metadata\/$/, //TODO dynamic pages should probably get a canonical URL too
      siteName: "WebHare Testsite",
      type: "website",
      image: {
        url: "https://beta.webhare.net/testpages/metadata/testimage.jpg",
        alt: "Test image",
      }
    }, parsed.openGraph, "Opengraph data should have been merged (siteName/type was global)");
  }

  {
    //test HS giving us readable metadata
    test.eq({
      image: {
        url: (await test.getTestSiteHS()).webRoot + "TestPages/rangetestfile.jpeg",
      },
      title: "webhare_testsuite.testsite",
      siteName: "webhare_testsuite.testsite",
      type: "website"
    }, (await fetchAsDoc("site::webhare_testsuite.testsite/testpages/dynamicpage", { shareimage: "1" })).openGraph);

    test.eq({
      title: "A share title",
      description: "A share description",
      siteName: "webhare_testsuite.testsite",
      type: "website"
    }, (await fetchAsDoc("site::webhare_testsuite.testsite/testpages/dynamicpage", { sharedescription: "1" })).openGraph);

    //test HS transferring opengraph data to TS
    test.eq({
      image: {
        url: (await test.getTestSiteJS()).webRoot + "TestPages/rangetestfile.jpeg",
      },
      siteName: "WebHare Testsite",
      type: "website"
    }, (await fetchAsDoc("site::webhare_testsuite.testsitejs/testpages/dynamicpage", { shareimage: "1" })).openGraph);

    test.eq({
      title: "A share title",
      description: "A share description",
      siteName: "WebHare Testsite",
      type: "website",
    }, (await fetchAsDoc("site::webhare_testsuite.testsitejs/testpages/dynamicpage", { sharedescription: "1" })).openGraph);
  }
}

test.runTests([
  testBreadCrumbs,
  testCustomStructuredData,
  testOpenGraph
]);
