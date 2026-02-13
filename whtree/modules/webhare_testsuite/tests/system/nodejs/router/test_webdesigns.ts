import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as whfs from "@webhare/whfs";
import type { WebResponse } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { XMLSerializer, type Document } from "@xmldom/xmldom";
import { captureJSPage } from "@mod-publisher/js/internal/capturejsdesign";
import { buildContentPageRequest, type CPageRequest } from "@webhare/router/src/siterequest";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { getTidLanguage } from "@webhare/gettid";
import { elements, parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import { litty, littyToString } from "@webhare/litty";
import { buildInstance } from "@webhare/services";

function getWHConfig(parseddoc: Document) {
  const config = parseddoc.getElementById("wh-config");
  if (!config)
    throw new Error("No wh-config element found");
  return JSON.parse(config.textContent || "");
}

async function verifyMarkdownResponse(markdowndoc: whfs.WHFSObject, response: WebResponse) {
  const doc = parseDocAsXML(await response.text(), "text/html");
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

function parseResponse(responsetext: string) {
  const doc = parseDocAsXML(responsetext, 'text/html');
  const htmlClasses = doc.documentElement?.getAttribute("class")?.split(" ") ?? [];
  const body = doc.getElementsByTagName("body")[0];
  const contentdiv = doc.getElementById("content");
  const contentElements = contentdiv ? elements(contentdiv.childNodes).
    map(e => new XMLSerializer().serializeToString(e)).
    map(s => s.replaceAll(" xmlns=\"http://www.w3.org/1999/xhtml\"", "")) : [];
  const bodyElements = body ? elements(body.childNodes).
    map(e => new XMLSerializer().serializeToString(e)).
    map(s => s.replaceAll(" xmlns=\"http://www.w3.org/1999/xhtml\"", "")) : [];

  return { responsetext, doc, body, contentElements, bodyElements, htmlClasses };
}

async function getAsDoc(whfspath: string) {
  const whfsobj = await whfs.openFile(whfspath);
  const sitereq = await buildContentPageRequest(new IncomingWebRequest(whfsobj.link!), whfsobj);
  const builder = await (sitereq as CPageRequest).getPageRenderer();
  if (!builder)
    throw new Error(`No builder found for this page`);

  const response = await builder(sitereq);

  return { response, ...parseResponse(await response.text()) };
}

async function fetchPreviewAsDoc(whfspath: string) {
  const whfsobj = await whfs.openFile(whfspath);
  const link = await whfsobj.getPreviewLink();

  console.log(`Fetching preview link for ${whfspath}: ${link}`);
  const fetchResult = await fetch(link);
  test.assert(fetchResult.ok, `Failed to fetch preview link: ${fetchResult.status} ${fetchResult.statusText}`);

  return parseResponse(await fetchResult.text());
}

//Test SiteResponse. we look a lot like testRouter except that we're not really using the file we open but just need it to bootstrap SiteRequest
async function testPageResponse() {
  // Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const sitereq = await buildContentPageRequest(new IncomingWebRequest(markdowndoc.link!), markdowndoc);
  sitereq.setFrontendData("webhare_testsuite:otherdata", { otherData: 112233 });

  const response: WebResponse = await sitereq.buildWebPage(litty`<p>This is a body!</p>`);
  const responsetext = await response.text();
  const doc = parseDocAsXML(responsetext, 'text/html');
  test.eq(markdowndoc.whfsPath, doc.getElementById("whfspath")?.textContent, "Expect our whfspath to be in the source");
  test.eq("en", doc.documentElement?.getAttribute("lang"));
  const whfspath = doc.getElementById("whfspath");
  test.eq("/webhare-tests/webhare_testsuite.testsitejs/TestPages/markdownpage", whfspath?.textContent);

  const contentdiv = doc.getElementById("content");
  test.eq("This is a body!", contentdiv?.getElementsByTagName("p")[0]?.textContent);
  test.eq("text/html;charset=utf-8", response.headers.get("content-type"));

  //Verify the GTM plugin is present
  const config = getWHConfig(doc);
  test.eq({ "a": "GTM-TN7QQM", "h": true, "m": false }, config["socialite:gtm"]);
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
}

async function testPageResponseApplies() {
  //test various <apply>s and that they affect the webdesign
  const { doc: langPsAFDoc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/staticpage-ps-af");
  test.eq("ps-AF", langPsAFDoc.documentElement?.getAttribute("lang"));
}

async function testPageResponseMarkdown() {
  //above tests skip over the actual page to build. let's actually render one now
  const { doc } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const contentdiv = doc.getElementById("content");
  test.eq("This is a commonmark marked down file with a JS link.", contentdiv?.getElementsByTagName("p")[0]?.textContent);
}

async function testPageResponseJSRTD() {
  {
    const { contentElements } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder");

    //small differences with the TS output: imgheight rounded down, more stray spaces there
    const expectContent = [
      `<p class="normal">indirect html widget:</p>`,
      `<div class="widgetblockwidget"><div class="widgetblockwidget__widget"><b>htmlwidget</b></div></div>`,
      `<p class="normal">indirect jswidget:</p>`,
      `<div class="widgetblockwidget"><div class="widgetblockwidget__widget"><div>js widget</div></div></div>`,
      `<p class="normal">direct html widget:</p>`,
      `<b>direct html</b>`,
      `<p class="normal">direct jswidget:</p>`,
      `<div>jswidget-direct2</div>`,
      /^<p class="normal">Een afbeelding: <img class="wh-rtd__img" src="\/.wh\/ea\/.*" alt="I&amp;G" width="160" height="106"\/><\/p>$/,
      /^<p class="normal">Een <a href="https:\/\/beta.webhare.net\/">externe<\/a> en een <a href=".*rangetestfile.jpeg#dieper">interne<\/a> link.<\/p>$/
    ];
    test.eq(expectContent, contentElements);

    const { contentElements: fetchedContentElements } = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder");
    test.eq(expectContent, fetchedContentElements);
  }

  {
    const { contentElements } = await getAsDoc("site::webhare_testsuite.testsitejs/testpages/widgetholder-ts");
    test.eq([
      `<p class="normal">indirect html widget:</p>`,
      `<div class="widgetblockwidget"><div class="widgetblockwidget__widget"><b>htmlwidget</b></div> </div>`,
      `<p class="normal">indirect jswidget:</p>`,
      `<div class="widgetblockwidget"><div class="widgetblockwidget__widget"><div>js widget</div></div> </div>`,
      `<p class="normal">direct html widget:</p>`,
      `<b>direct html</b>`,
      `<p class="normal">direct jswidget:</p>`,
      `<div>jswidget-direct2</div>`,
      /^<p class="normal">Een afbeelding: <img class="wh-rtd__img" src="\/.wh\/ea\/.*" alt="I&amp;G" width="160" height="107"\/><\/p>$/,
      /^<p class="normal">Een <a href="https:\/\/beta.webhare.net\/">externe<\/a> en een <a href=".*rangetestfile.jpeg#dieper">interne<\/a> link.<\/p>$/
    ], contentElements);
  }

  //Test widget preview in testsite (HS renderer)
  const htmlWidgetHSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/testpages/htmlwidget");
  test.eq([`<b>htmlwidget</b>`], htmlWidgetHSSite.bodyElements);
  test.eq(["wh-widgetpreview","wh-preview"], htmlWidgetHSSite.htmlClasses);

  const jsWidgetHSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsite/testpages/jswidget");
  test.eq([`<div>js widget</div>`], jsWidgetHSSite.bodyElements);
  test.eq(["wh-widgetpreview","wh-preview"], jsWidgetHSSite.htmlClasses);

  //Test widget preview in testsitejs (JS renderer)
  const htmlWidgetJSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/htmlwidget");
  test.eq([`<b>htmlwidget</b>`], htmlWidgetJSSite.bodyElements);
  test.eq(["wh-widgetpreview"], htmlWidgetJSSite.htmlClasses);

  const jsWidgetJSSite = await fetchPreviewAsDoc("site::webhare_testsuite.testsitejs/testpages/jswidget");
  test.eq([`<div>js widget</div>`], jsWidgetJSSite.bodyElements);
  test.eq(["wh-widgetpreview"], jsWidgetJSSite.htmlClasses);
}

async function testPublishedJSSite() {
  //TODO this is a weird edge case, reconsider this file - the file isn't marked as needstemplate so preview etc break too for unrelated reasons
  const jsrendereddoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/staticpage-nl-jsrendered.html");
  {
    console.log(`Fetching published version: ${jsrendereddoc.link}`);
    const jsrenderedfetch = await fetch(jsrendereddoc.link!);
    test.assert(jsrenderedfetch.ok);
    const jsresultdoc = parseDocAsXML(await jsrenderedfetch.text(), 'text/html');
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
  test.eq(/<html.*<body.*<div id="content".*<code>commonmark<\/code>.*<\/div>.*\/body.*\/html/, (await resultpage.body.text()).replaceAll("\n", " "));

  const jsrendereddoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/staticpage-nl-jsrendered.html");
  const jsresultpage = await captureJSPage(jsrendereddoc.id);
  const jsresultdoc = parseDocAsXML(await jsresultpage.body.text(), 'text/html');
  test.eq("nl", jsresultdoc.documentElement?.getAttribute("lang"));
  test.eq("Basetest title (from NL language file)", jsresultdoc.getElementById("basetitle")?.textContent);
  test.eq("dutch a&b<c", jsresultdoc.getElementById("gettidtest")?.textContent);

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
  testPageResponse,
  testPageResponseApplies,
  testPageResponseMarkdown,
  testPageResponseJSRTD,
  testPublishedJSSite,
  testCaptureJSRendered,
  testRouter_HSWebDesign,
  testRouter_JSWebDesign
]);
