import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { fetchAsDoc, fetchPreviewAsDoc, getAsDoc } from "@mod-webhare_testsuite/js/whfs";
import { openSite } from "@webhare/whfs/src/sites";

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

async function testGTM() {
  { //test HS/HS page with GTM plugin
    const dynamicPage = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/TestPages/consenttest.rtd");
    test.eq({ a: "GTM-TN7QQM", m: true }, dynamicPage.config?.["socialite:gtm"]);
    test.eq(/<wh-socialite-gtm push.*datalayerpush.*420042004200}/, dynamicPage.responsetext);
  }
  { //test TS hosted HS page
    const dynamicPage = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/TestPages/staticpage.html");
    test.eq({ a: "GTM-TN7QQM", m: false }, dynamicPage.config?.["socialite:gtm"]);
    test.eq(/<wh-socialite-gtm push.*datalayerpush.*430043004300}/, dynamicPage.responsetext);
  }
  { //test TS hosted HS page that adds its own datalayer push
    const dynamicPage = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/TestPages/dynamicpage");
    test.eq({ a: "GTM-TN7QQM", m: false }, dynamicPage.config?.["socialite:gtm"]);
    test.eq(/<wh-socialite-gtm push.*datalayerpush.*430043004300}/, dynamicPage.responsetext);
    test.eq(/<wh-socialite-gtm push.*HiThere/, dynamicPage.responsetext);
  }
}

async function testPageMetadata() {
  //HS generated, HS and TS rendered
  for (const site of ["webhare_testsuite.testsite", "webhare_testsuite.testsitejs"]) {
    const siteObj = await openSite(site);
    const dynamicPage = await fetchPreviewAsDoc(`site::${site}/TestPages/dynamicpage`, { setmetadata: "1" });
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

    const htmlClasses = dynamicPage.doc.documentElement?.getAttribute("class")?.split(" ") ?? [];
    test.assert(htmlClasses.includes("html--dynamicpage"), "HS generated class should be present in " + site);
    test.eq("asxd-8231", dynamicPage.doc.documentElement?.getAttribute("data-test_data_field"));

    test.eqPartial([{ href: siteObj.webRoot + "TestPages/dynamicpage/?canonical=true" }], dynamicPage.linkMap.get("canonical"), `Canonical link should be present in ${site}`);

    const breadcrumbs = dynamicPage.schemaOrg.filter(_ => _["@type"] === "BreadcrumbList");
    test.eqPartial([
      {
        itemListElement: [
          {
            item: siteObj.webRoot!,
            name: siteObj.name,
          }, {
            item: siteObj.webRoot + "TestPages/dynamicpage/",
            name: "dynamicpage"
          }, {
            item: siteObj.webRoot + "TestPages/dynamicpage/?canonical=true#custom",
            name: "Custom entry"
          }
        ]
      }
    ], breadcrumbs, `Breadcrumbs should be present in ${site} and contain the custom entry added by the page's GetPageBody macro`);

    test.eq("dynamic page", dynamicPage.doc.getElementsByTagName("title")[0]?.textContent, `Page title should be rendered in ${site}`);
    test.eq("A dynamic page", dynamicPage.metaTags.get("description"), `Page description should be present in meta tags in ${site}`);

    test.eq("consilio </script> value", dynamicPage.consilioFields.test_consilio, `Custom consilio field should be present in ${site}`);
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
  testGTM,
  testPageMetadata,
  testOpenGraph
]);
