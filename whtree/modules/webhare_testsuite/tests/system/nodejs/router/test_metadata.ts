import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { fetchAsDoc, fetchPreviewAsDoc, getAsDoc } from "@mod-webhare_testsuite/js/whfs";
import { openSite, openFile, whfsType } from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";
import { createContentPageRequest } from "@webhare/router";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { IntExtLink } from "@webhare/services";

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
      position: 1
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
      position: 1
    }, {
      "@type": "ListItem",
      item: testSiteRoot + "TestPages/StaticPage/",
      name: "StaticPage",
      position: 2
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

    const dynamicPageNoBreadcrumb = await fetchPreviewAsDoc(`site::${site}/TestPages/dynamicpage`, { setmetadata: "1", nobreadcrumb: "1" });
    test.eq([], dynamicPageNoBreadcrumb.schemaOrg.filter(_ => _["@type"] === "BreadcrumbList"), `Breadcrumbs should not be present in ${site} when nobreadcrumb is set`);
  }

  //test metadata
  const markdowndoc = await openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const markdownReq = await createContentPageRequest(markdowndoc, { webRequest: new IncomingWebRequest(markdowndoc.link!) });
  test.eq([
    { id: markdowndoc.parentSite!, name: "webhare_testsuite.testsitejs", title: "", link: (await openSite(markdowndoc.parentSite!)).webRoot },
    { id: markdowndoc.parent!, name: "TestPages", title: "", link: null },
    { id: markdowndoc.id, name: "markdownpage", title: "Markdown page", link: markdowndoc.link },
  ], markdownReq.targetPath);
  test.eq("Markdown page", markdownReq.pageMetadata.title);
  test.eq("Markdown page", markdownReq.pageMetadata.pageHeading);

  /* Test SEO titles etc
     doc1:
     - title: Meta title
     - seoTitle: SEO title
     - pageHeading: <should fall back to Meta title>

     doc1-clink1 - points to doc1, no metadata of its own

     doc1-clink2 - points to doc1
     - title: Doc1 Clink2

     doc2:
     - title: (empty, falls back to folder title)
     - seoTitle: (mepty)
     - pageHeading: (empty - no fallback to doc2 fs_object title)

     doc3:
     - title: (empty, falls back to folder title)
     - seoTitle: SEO title
     - pageHeading: (empty - no fallback to doc2 fs_object title or to seo title)
     */
  await beginWork();
  const testfolder = await (await test.getTestSiteJSTemp()).ensureFolder("testmetadata", { title: "Folder title" });

  const doc1 = await testfolder.ensureFile("doc1", { publish: true, title: "The meta title", type: "platform:filetypes.markdown" });
  await whfsType("platform:web.metadata").set(doc1.id, { seoTitle: "The seo title 1" });
  const doc1Req = await createContentPageRequest(doc1, { webRequest: new IncomingWebRequest(doc1.link!) });

  test.eq("The seo title 1", doc1Req.pageMetadata.title);
  test.eq("The meta title", doc1Req.pageMetadata.pageHeading, "should fallback to Meta title, not seoTitle");

  const doc1clink1 = await testfolder.ensureFile("doc1clink1", { publish: true, title: "", type: "platform:filetypes.contentlink", target: new IntExtLink(doc1.id) });
  const doc1clinkreq1 = await createContentPageRequest(doc1clink1, { webRequest: new IncomingWebRequest(doc1clink1.link!) });

  test.eq("", doc1clinkreq1.pageMetadata.title);
  test.eq("", doc1clinkreq1.pageMetadata.pageHeading);

  await testfolder.update({ indexDoc: doc1clink1.id });
  const doc1clink1asIndex = await openFile(doc1clink1.id);
  const doc1clinkreq1asIndex = await createContentPageRequest(doc1clink1asIndex, { webRequest: new IncomingWebRequest(doc1clink1asIndex.link!) });

  test.eq("Folder title", doc1clinkreq1asIndex.pageMetadata.title);
  test.eq("Folder title", doc1clinkreq1asIndex.pageMetadata.pageHeading);

  const doc1clink2 = await testfolder.ensureFile("doc1clink2", { publish: true, title: "Doc1 Clink2", type: "platform:filetypes.contentlink", target: new IntExtLink(doc1.id) });
  const doc1clinkreq2 = await createContentPageRequest(doc1clink2, { webRequest: new IncomingWebRequest(doc1clink2.link!) });

  test.eq("Doc1 Clink2", doc1clinkreq2.pageMetadata.title);
  test.eq("Doc1 Clink2", doc1clinkreq2.pageMetadata.pageHeading);

  const doc2 = await testfolder.ensureFile("doc2", { publish: true, title: "", type: "platform:filetypes.markdown" });
  const doc2Req = await createContentPageRequest(doc2, { webRequest: new IncomingWebRequest(doc2.link!) });

  test.eq("", doc2Req.pageMetadata.title);
  test.eq("", doc2Req.pageMetadata.pageHeading);

  await testfolder.update({ indexDoc: doc2.id });
  const doc2AsIndex = await openFile(doc2.id);
  const doc2AsIndexReq = await createContentPageRequest(doc2AsIndex, { webRequest: new IncomingWebRequest(doc2AsIndex.link!) });

  test.eq("Folder title", doc2AsIndexReq.pageMetadata.title);
  test.eq("Folder title", doc2AsIndexReq.pageMetadata.pageHeading);

  const doc3 = await testfolder.ensureFile("doc3", { publish: true, title: "", type: "platform:filetypes.markdown" });
  await whfsType("platform:web.metadata").set(doc3.id, { seoTitle: "The seo title 3" });
  const doc3Req = await createContentPageRequest(doc3, { webRequest: new IncomingWebRequest(doc3.link!) });

  test.eq("The seo title 3", doc3Req.pageMetadata.title);
  test.eq("", doc3Req.pageMetadata.pageHeading);

  await testfolder.update({ indexDoc: doc3.id });
  const doc3AsIndex = await openFile(doc3.id);
  const doc3AsIndexReq = await createContentPageRequest(doc3AsIndex, { webRequest: new IncomingWebRequest(doc3AsIndex.link!) });

  test.eq("The seo title 3", doc3AsIndexReq.pageMetadata.title);
  test.eq("Folder title", doc3AsIndexReq.pageMetadata.pageHeading);

  //TODO test with versions too, they differ from contentlinks

  await commitWork();
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
  test.resetWTS,
  testBreadCrumbs,
  testGTM,
  testPageMetadata,
  testOpenGraph
]);
