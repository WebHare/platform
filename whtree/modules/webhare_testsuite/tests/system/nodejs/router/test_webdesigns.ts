import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as whfs from "@webhare/whfs";
import { createContentPageRequest, type WebResponse } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { captureJSPage } from "@mod-publisher/js/internal/capturejsdesign";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { getTidLanguage } from "@webhare/gettid";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import { litty, littyToString } from "@webhare/litty";
import { backendConfig, buildInstance, buildRTD } from "@webhare/services";
import type { } from "@mod-publisher/js/internal/plugins/gtmplugin.ts"; //make config["socialite:gtm"] work
import { parseResponse, getWHConfig, getAsDoc, fetchPreviewAsDoc } from "@mod-webhare_testsuite/js/whfs";
import { loadlib } from "@webhare/harescript";
import { getTestSiteJS } from "@mod-webhare_testsuite/js/wts-backend.ts";
import { openSite } from "@webhare/whfs";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { getAssetBase } from "@webhare/env";

async function verifyMarkdownResponse(markdowndoc: whfs.WHFSObject, response: WebResponse) {
  const doc = parseDocAsXML(await response.text(), "text/html", { rewriteHTML: true });
  test.eq(markdowndoc.whfsPath, doc.getElementById("whfspath")?.textContent, "Expect our whfspath to be in the source");

  const contentdiv = doc.getElementById("content");
  test.eq("Markdown file", contentdiv?.getElementsByTagName("h2")[0]?.textContent);
  test.eq("heading2", contentdiv?.getElementsByTagName("h2")[0]?.getAttribute("class"));
  const firstpara = contentdiv?.getElementsByTagName("p")[0];
  test.assert(firstpara);
  test.eq("This is a commonmark marked down file with a JS link.", firstpara.textContent);
  const firstlink = firstpara.getElementsByTagName("a")[0];
  test.eq('javascript:alert(%22HI%22)', firstlink.getAttribute("href"));
  test.eq('JS link', firstlink.textContent);
  test.eq("commonmark", firstpara.getElementsByTagName("code")[0]?.textContent);
  test.eq("normal", firstpara.getAttribute("class"));
  //FIXME also ensure proper classes on table and tr/td!
  test.eq("baz", contentdiv?.getElementsByTagName("td")[0]?.textContent);
  test.eq("bim", contentdiv?.getElementsByTagName("td")[1]?.textContent);

  const nextpara = contentdiv?.getElementsByTagName("p")[1];
  const nextlink = nextpara.getElementsByTagName("a")[0];
  test.eq('http://example.net/linkify', nextlink.getAttribute("href"));
  test.eq('http://example.net/linkify', nextlink.textContent);
}

//Test SiteResponse. we look a lot like testRouter except that we're not really using the file we open but just need it to bootstrap SiteRequest
async function testPageResponse() {
  // Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const sitereq = await createContentPageRequest(markdowndoc, { webRequest: new IncomingWebRequest(markdowndoc.link!) });
  test.eq([
    { id: markdowndoc.parentSite!, name: "webhare_testsuite.testsitejs", title: "", link: (await whfs.openSite(markdowndoc.parentSite!)).webRoot },
    { id: markdowndoc.parent!, name: "TestPages", title: "", link: null },
    { id: markdowndoc.id, name: "markdownpage", title: "Markdown page", link: markdowndoc.link },
  ], sitereq.targetPath);

  sitereq.setFrontendData("webhare_testsuite:otherdata", { otherData: 112233 });

  const response: WebResponse = await sitereq.buildWebPage(litty`<p>This is a body!</p>`);
  const responsetext = await response.text();
  const doc = parseDocAsXML(responsetext, 'text/html', { rewriteHTML: true });
  test.eq(markdowndoc.whfsPath, doc.getElementById("whfspath")?.textContent, "Expect our whfspath to be in the source");
  test.eq("en", doc.documentElement?.getAttribute("lang"));
  const whfspath = doc.getElementById("whfspath");
  test.eq("/webhare-tests/webhare_testsuite.testsitejs/TestPages/markdownpage", whfspath?.textContent);

  const contentdiv = doc.getElementById("content");
  test.eq("This is a body!", contentdiv?.getElementsByTagName("p")[0]?.textContent);
  test.eq("text/html;charset=utf-8", response.headers.get("content-type"));

  //Verify the GTM plugin is present
  const config = getWHConfig(doc);
  test.eq({ "a": "GTM-TN7QQM", "m": false }, config["socialite:gtm"]);
  test.eq({ otherData: 112233 }, config["webhare_testsuite:otherdata"]);
  test.eq({ notOurAlarmCode: 424242 }, config["webhare_testsuite:basetestjs"]);

  //Verify the GTM noscript is present
  test.eq(/.*<noscript>.*<iframe.*src=".*googletagmanager.com.*id=GTM-TN7QQM".*<\/noscript>.*/, responsetext.replaceAll("\n", " "));

  //Render a widget
  const jsWidget1 = await sitereq.renderWidget(await buildInstance({
    whfsType: "webhare_testsuite:base_test.jswidget1",
    data: { field1: "value1" }
  }));
  test.eq(`<div>value1</div>`, await littyToString(jsWidget1));

  //Preview a HS widget
  const hsWidget = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/hswidget-embed-lvl1");
  test.eqPartial([{ tag: 'div', attributes: { class: "level1widget" } }, {}], hsWidget.bodyElements);

  //Regression: the '<b></b>' part was rendered as '[Object object]'
  const richDocument = await sitereq.renderRTD(await buildRTD([
    { h1: ["Heading 1"] },
    { tag: "p", items: [] }, //empty line without items
    { "p.intro": [{ text: "default p with " }, { text: "bold", bold: true }, { text: " text." }] }
  ]));
  test.eq(`<h1 class="heading1">Heading 1</h1><p class="normal"><br></p><p class="intro">default p with <b>bold</b> text.</p>`, await littyToString(richDocument));
}

async function testPaths() {
  test.eq(null, getAssetBase(), "verify initial state");

  async function verifyImageDoc(expectCDN: boolean) {
    const staticDoc = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/images");
    const smallBob = staticDoc.doc.getElementById("smallbob");
    test.assert(smallBob);

    test.eq(expectCDN ? "https://beta.webhare.net/sub/.wh/mod/webhare_testsuite/public/img/smallbob.jpg" : "/.wh/mod/webhare_testsuite/public/img/smallbob.jpg", smallBob.getAttribute("src"));

    const fish = staticDoc.doc.getElementsByClassName("wh-rtd__img")[0];
    test.eq(expectCDN ? /^https:\/\/beta\.webhare\.net\/sub\/\.wh\/ea\/uc\// : /^\/\.wh\/ea\/uc\//, fish?.getAttribute("src"));
  }

  await verifyImageDoc(false);

  await beginWork();
  const testsite = await openSite("webhare_testsuite.testsitejs");
  test.eq(null, testsite.cdnBaseURL, "should have been cleared by test.reset");

  await test.throws(/must end with a slash/, () => testsite.update({ cdnBaseURL: "" }));
  await test.throws(/must end with a slash/, () => testsite.update({ cdnBaseURL: "https://beta.webhare.net/sub" }));

  await testsite.update({ cdnBaseURL: "https://beta.webhare.net/sub/" });
  test.eq("https://beta.webhare.net/sub/", testsite.cdnBaseURL);
  await commitWork();

  await verifyImageDoc(true);
  test.eq(null, getAssetBase(), "assetbase we see shouldn't have changed");

  await runInWork(() => testsite.update({ cdnBaseURL: null })); // Reset for further tests
}

async function testDynamicPage() {
  {
    const dynamicPage = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/dynamicpage-js");
    const fetchResult = await fetch(dynamicPage.link + "?echo=1234");
    const response = parseResponse(await fetchResult.text());
    test.eqPartial([{ tag: "p", textContent: 'renderDynamicPage(echo = 1234)' }], response.contentElements);
    test.eq(/Dynamic request from/, response.doc.getElementById("isdynamicrequest")?.textContent);
  }

  //Verify TestPages/dynamicpage-override-js/ is indeed being handled by JS (it's a SHTML page but being overridden using siteprofiles)
  {
    { //HS site
      const dynamicPage = await whfs.openFile("site::webhare_testsuite.testsite/TestPages/dynamicpage-override-js");
      const fetchResult = await fetch(dynamicPage.link + "?echo=12378");
      const response = parseResponse(await fetchResult.text());
      test.eqPartial([{ tag: "p", textContent: 'renderDynamicPage(echo = 12378)' }], response.contentElements, dynamicPage.link + "?echo=12378");
    }
    { //JS site
      const dynamicPage = await whfs.openFile("site::webhare_testsuite.testsitejs/TestPages/dynamicpage-override-js");
      const fetchResult = await fetch(dynamicPage.link + "?echo=12379");
      const response = parseResponse(await fetchResult.text());
      test.eqPartial([{ tag: "p", textContent: 'renderDynamicPage(echo = 12379)' }], response.contentElements, dynamicPage.link + "?echo=12379");
    }
  }

  //Verify TestPages/dynamicpage-override-hs/ is indeed being handled by its new handler (but still a HS one)
  {
    { //HS site
      const dynamicPage = await whfs.openFile("site::webhare_testsuite.testsite/TestPages/dynamicpage-override-hs");
      const fetchResult = await fetch(dynamicPage.link + "?echo=12378");
      const response = parseResponse(await fetchResult.text());
      test.eqPartial([{ attributes: { id: "dynamicpage_override" }, tag: "div", textContent: "This is DynamicPageOverride with echo=12378" }], response.contentElements, dynamicPage.link + "?echo=12378");
    }
    { //JS site
      const dynamicPage = await whfs.openFile("site::webhare_testsuite.testsitejs/TestPages/dynamicpage-override-hs");
      const fetchResult = await fetch(dynamicPage.link + "?echo=12378");
      const response = parseResponse(await fetchResult.text());
      test.eqPartial([
        { attributes: { id: "dynamicpage_override" }, tag: "div", textContent: "This is DynamicPageOverride with echo=12378" },
        { attributes: { id: "dynamicpageinfo" }, tag: "div", textContent: '{"echoWebVar":"12378"}' }
      ], response.contentElements, dynamicPage.link + "?echo=12378");
      test.eq({ echoWebVar: "12378" }, response.config?.["webhare_testsuite:dynamicpagefrontend"]);
    }
  }

  //Verify TestPages/dynfolder is routed properly
  {
    //HS Site
    { //HS site
      const dynamicPage = await whfs.openFolder("site::webhare_testsuite.testsite/TestPages/dynfolder/");
      test.assert(dynamicPage.link, "Folder should have a link since it has an index doc");
      const fetchResult = await fetch(dynamicPage.link);
      const response = parseResponse(await fetchResult.text());
      test.eqPartial({ attributes: { id: "whfspath" }, tag: "div", textContent: "/webhare-tests/webhare_testsuite.testsite/TestPages/dynfolder/index" }, response.bodyElements[1], dynamicPage.link);
    }
    { //JS site
      const dynamicPage = await whfs.openFolder("site::webhare_testsuite.testsitejs/TestPages/dynfolder/");
      test.assert(dynamicPage.link, "Folder should have a link since it has an index doc");
      const fetchResult = await fetch(dynamicPage.link);
      const response = parseResponse(await fetchResult.text());
      test.eqPartial({ attributes: { id: "whfspath" }, tag: "div", textContent: "/webhare-tests/webhare_testsuite.testsitejs/TestPages/dynfolder/index" }, response.bodyElements[1], dynamicPage.link);
    }
  }

  { //Verify the form test renders (testing the RunPageForWHFSId path)
    const formtesturl: string = await loadlib("mod::publisher/lib/internal/forms/hooks.whlib").getFormTestURL((await getTestSiteJS()).id);
    const finalurl = new URL(formtesturl, backendConfig.backendURL).href;
    console.log("Form test URL:", finalurl);
    const fetchResult = parseResponse(await (await fetch(finalurl)).text());
    test.eq(/Basetest title.*Full demo/s, fetchResult.responsetext, "Verifies both the template 'Basetest title' and content 'Full demo' appears");
    test.eq(2, fetchResult.responsetext.split("<html").length, "Response should not contain nested html tags");
  }

  { //Verify the dynrouter works
    const finalurl = (await getTestSiteJS()).webRoot + "testpages/dynrouter/?test=sendwebfile";
    console.log("dynrouter test URL:", finalurl);
    const fetchResult = await fetch(finalurl);
    test.eq("text/plain", fetchResult.headers.get("Content-Type"));
    test.eq("A web file -\u0000- with a null", await fetchResult.text());
  }

  { //Verify HS RunPageWithContents in a TS design
    const testurl = backendConfig.backendURL + "tollium_todd.res/webhare_testsuite/tests/webdesign.shtml?type=RunPageWithContents";
    const fetchResult = await fetch(testurl);
    test.eq(200, fetchResult.status, "Failed to fetch " + testurl);
    const text = await fetchResult.text();
    test.eq(/Basetest title.*This is RunPageWithContents/s, text, "Verifies both the template 'Basetest title' and content 'This is RunPageWithContents' appears");
    test.eq(2, text.split("<html").length, "Response should not contain nested html tags");
  }

  { //Verify the dynrouter works
    const finalurl = (await getTestSiteJS()).webRoot + "testpages/dynrouter/?test=sendwebfile";
    console.log("dynrouter test URL:", finalurl);
    const fetchResult = await fetch(finalurl);
    test.eq("text/plain", fetchResult.headers.get("Content-Type"));
    test.eq("A web file -\u0000- with a null", await fetchResult.text());
  }
}

function testIsMinified(text: string) {
  return text.match(/<meta charset="?utf-8"?><title>/);
}

async function testPageResponseApplies() {
  //test various <apply>s and that they affect the webdesign
  const psAfDoc = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage-ps-af");
  test.eq("ps-AF", psAfDoc.doc.documentElement?.getAttribute("lang"));
  test.eq("width=device-width,initial-scale=1", psAfDoc.metaTags.get("viewport"), "minify step removed the space");
  test.eq("ltr", psAfDoc.doc.documentElement?.getAttribute("dir"));
  test.assert(testIsMinified(psAfDoc.responsetext));
}

async function testPageResponseMarkdown() {
  //above tests skip over the actual page to build. let's actually render one now
  const { doc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const contentdiv = doc.getElementById("content");
  test.eq("This is a commonmark marked down file with a JS link.", contentdiv?.getElementsByTagName("p")[0]?.textContent);
}

async function testPageResponsePlainPages() {
  {
    const { doc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage.html");
    const contentdiv = doc.getElementById("content");
    test.eq("HTML CODE", contentdiv?.getElementsByTagName("p")[0].getElementsByTagName("b")[0]?.textContent); //expect <p>b>HTML CODE
  }
  {
    const { doc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/contentlisting");
    const contentdiv = doc.getElementById("content");
    test.eq('', contentdiv?.textContent?.trim()); //TODO once we minify should be able to do this without trim ?
  }
}

async function testPageResponseJSRTD() {
  {
    const { contentElements } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder-hs");
    //small differences with the TS output: imgheight rounded down, more stray spaces there
    const expectContent = [
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['indirect html widget:'],
      },
      {
        tag: 'div',
        attributes: { class: 'widgetblockwidget' },
        children: [
          {
            tag: 'div',
            attributes: { class: 'widgetblockwidget__widget' },
            children: [
              {
                tag: 'b',
                attributes: {},
                children: ['htmlwidget'],
              }
            ],
          }
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['indirect jswidget:'],
      },
      {
        tag: 'div',
        attributes: { class: 'widgetblockwidget' },
        children: [
          {
            tag: 'div',
            attributes: { class: 'widgetblockwidget__widget' },
            children: [
              {
                tag: 'div',
                attributes: {},
                children: ['js widget'],
              }
            ],
          }
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['direct html widget:'],
      },
      {
        tag: 'b',
        attributes: {},
        children: ['direct html'],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['direct jswidget:'],
      },
      {
        tag: 'div',
        attributes: {},
        children: ['jswidget-direct2'],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: [
          'Een afbeelding: ',
          {
            tag: 'img',
            attributes: {
              class: 'wh-rtd__img',
              src: /^\/.wh\/ea\/uc\/.*\.*$/,
              alt: 'I&G',
              width: '160',
              height: '106'
            },
            children: [],
          }
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: [
          'Een ',
          {
            tag: 'a',
            attributes: { href: 'https://beta.webhare.net/' },
            children: ['externe'],
          },
          ' en een ',
          {
            tag: 'a',
            attributes: { href: /\/TestPages\/rangetestfile\.jpeg#dieper$/ },
            children: ['interne'],
          },
          ' link.'
        ],
      }
    ] as const;
    test.eqPartial(expectContent, contentElements);

    const { contentElements: fetchedContentElements, doc: fetchedDoc, headers } = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder-hs");
    test.eqPartial(expectContent, fetchedContentElements);
    test.assert(fetchedDoc.getElementById("isdynamicrequest") === null); //it's a static page, should not see a webRequest even if using preview
    test.eq(/callJs.*pageRender.*onRenderPage/, headers.get("server-timing"));
  }

  {
    const expectContent = [
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['indirect html widget:'],
      },
      {
        tag: 'div',
        attributes: { class: 'widgetblockwidget' },
        children: [
          {
            tag: 'div',
            attributes: { class: 'widgetblockwidget__widget' },
            children: [
              {
                tag: 'b',
                attributes: {},
                children: ['htmlwidget'],
              }
            ],
          },
          ' '
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['indirect jswidget:'],
      },
      {
        tag: 'div',
        attributes: { class: 'widgetblockwidget' },
        children: [
          {
            tag: 'div',
            attributes: { class: 'widgetblockwidget__widget' },
            children: [
              {
                tag: 'div',
                attributes: {},
                children: ['js widget'],
              }
            ],
          },
          ' '
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['direct html widget:'],
      },
      {
        tag: 'b',
        attributes: {},
        children: ['direct html'],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: ['direct jswidget:'],
      },
      {
        tag: 'div',
        attributes: {},
        children: ['jswidget-direct2'],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: [
          'Een afbeelding: ',
          {
            tag: 'img',
            attributes: {
              class: 'wh-rtd__img',
              src: /^\/.wh\/ea\/uc\/.*\.*$/,
              alt: 'I&G',
              width: '160',
              height: '107'
            },
            children: [],
          }
        ],
      },
      {
        tag: 'p',
        attributes: { class: 'normal' },
        children: [
          'Een ',
          {
            tag: 'a',
            attributes: { href: 'https://beta.webhare.net/' },
            children: ['externe'],
          },
          ' en een ',
          {
            tag: 'a',
            attributes: { href: /\/TestPages\/rangetestfile\.jpeg#dieper$/ },
            children: ['interne'],
          },
          ' link.'
        ],
      }
    ] as const;

    const { contentElements: contentElementsTSTS, doc: docTSTS, responsetext: unminifiedDoc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder-ts");
    test.eqPartial(expectContent, contentElementsTSTS);
    test.assert(!testIsMinified(unminifiedDoc));
    test.assert(docTSTS.getElementById("isdynamicrequest") === null); //it's a static page, should not see a webRequest even if using preview

    const { contentElements: contentElementsHSTS } = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/testpages/widgetholder-ts");
    test.eqPartial(expectContent, contentElementsHSTS);

    const { contentElements } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder");
    test.eqPartial(expectContent, contentElements);
  }

  //Test widget preview in testsite (HS renderer)
  const htmlWidgetHSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/testpages/htmlwidget");
  test.eqPartial([{ attributes: {}, children: ["htmlwidget"], tag: "b" }], htmlWidgetHSSite.bodyElements);

  const jsWidgetHSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/testpages/jswidget");
  test.eqPartial([{ attributes: {}, children: ["js widget"], tag: "div" }], jsWidgetHSSite.bodyElements);

  //Test widget preview in testsitejs (JS renderer)
  const htmlWidgetJSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/htmlwidget");
  test.eqPartial([
    { tag: "b", children: ["htmlwidget"] },
    { tag: "script", attributes: { type: "application/ld+json" } }
  ], htmlWidgetJSSite.bodyElements);
  test.eq(["wh-widgetpreview"], htmlWidgetJSSite.htmlClasses);

  const jsWidgetJSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/jswidget");
  test.eqPartial([
    { tag: "div", children: ["js widget"] },
    { tag: "script", attributes: { type: "application/ld+json" } }
  ], jsWidgetJSSite.bodyElements);
  test.eq(["wh-widgetpreview"], jsWidgetJSSite.htmlClasses);
}

async function testPublishedJSSite() {
  //TODO this is a weird edge case, reconsider this file - the file isn't marked as needstemplate so preview etc break too for unrelated reasons
  const jsrendereddoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/staticpage-nl-jsrendered.html");
  {
    console.log(`Fetching published version: ${jsrendereddoc.link}`);
    const jsrenderedfetch = await fetch(jsrendereddoc.link!);
    test.assert(jsrenderedfetch.ok);
    const jsresultdoc = parseDocAsXML(await jsrenderedfetch.text(), 'text/html', { rewriteHTML: true });
    test.eq("nl", jsresultdoc.documentElement?.getAttribute("lang"));
    test.eq("Basetest title (from NL language file)", jsresultdoc.getElementById("basetitle")?.textContent);
    test.eq("dutch a&b<c", jsresultdoc.getElementById("gettidtest")?.textContent);
  }
}

async function testCaptureJSRendered() {
  test.eq("en", getTidLanguage(), "pre-condition: no reason for the language to have changed yet");

  //Test capturing a JS Page rendered in a WHLIB design
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const resultpage = await captureJSPage(markdowndoc.id);

  // Note that captureJSPage is designed to be invoked from HareScript therefore it returns a HS Blob
  test.eq(/<html.*data-other-field.*<body.*<div.*id=.?content.*<code>commonmark<\/code>.*<\/div>.*\/body.*\/html/, (await resultpage.body.text()).replaceAll("\n", " "));

  const jsrendereddoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/staticpage-nl-jsrendered.html");
  const jsresultpage = await captureJSPage(jsrendereddoc.id);
  const jsresultdoc = parseDocAsXML(await jsresultpage.body.text(), 'text/html', { rewriteHTML: true });
  test.eq("nl", jsresultdoc.documentElement?.getAttribute("lang"));
  test.eq("Basetest title (from NL language file)", jsresultdoc.getElementById("basetitle")?.textContent);
  test.eq("dutch a&b<c", jsresultdoc.getElementById("gettidtest")?.textContent);

  test.eq("test", jsresultdoc.documentElement?.getAttribute("data-test"));
  test.eq("", jsresultdoc.documentElement?.getAttribute("data-other-field"));
  test.eq(null, jsresultdoc.documentElement?.getAttribute("data-nonexisting"));

  test.eq("en", getTidLanguage(), "ensure captureJSPage didn't affect our language");
}

//Unlike testPageResponse the testRouter_... tests actually attempt to render the markdown document *and* go through the path lookup motions
async function testRouter_HSWebDesign() {
  const { port, clientIp, localAddress } = await test.getTestWebserver("webhare_testsuite:basicrouter");
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const result = await coreWebHareRouter(port, new IncomingWebRequest(markdowndoc.link!, { clientIp }), localAddress);

  await verifyMarkdownResponse(markdowndoc, result);
}

async function testRouter_JSWebDesign() {
  const { port, clientIp, localAddress } = await test.getTestWebserver("webhare_testsuite:basicrouter");
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const result = await coreWebHareRouter(port, new IncomingWebRequest(markdowndoc.link!, { clientIp }), localAddress);

  await verifyMarkdownResponse(markdowndoc, result);
}

test.runTests([
  test.reset,
  testPageResponse,
  testPaths,
  testDynamicPage,
  testPageResponseApplies,
  testPageResponseMarkdown,
  testPageResponsePlainPages,
  testPageResponseJSRTD,
  testPublishedJSSite,
  testCaptureJSRendered,
  testRouter_HSWebDesign,
  testRouter_JSWebDesign
]);
