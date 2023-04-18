import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { WebRequest, WebResponse } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { BaseTestPageConfig } from "@mod-webhare_testsuite/webdesigns/basetestjs/webdesign/webdesign";
//TODO why doesn't this work?  Now importing it into testsuite's package.json
//import { DOMParser } from "wh:internal/whtree/node_modules/@xmldom/xmldom";
import { DOMParser } from "@xmldom/xmldom";
import { captureJSDesign, captureJSPage } from "@mod-publisher/js/internal/capturejsdesign";
import { buildSiteRequest } from "@webhare/router/src/siterequest";

function parseHTMLDoc(html: string): Document {
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- we want an empty function!
  return new DOMParser({ errorHandler: { warning: w => { } } }).parseFromString(html, "text/html");
}

function getWHConfig(parseddoc: Document) {
  const config = parseddoc.getElementById("wh-config");
  if (!config)
    throw new Error("No wh-config element found");
  return JSON.parse(config.textContent || "");
}

async function verifyMarkdownResponse(markdowndoc: whfs.WHFSObject, response: WebResponse) {
  const doc = parseHTMLDoc(await response.text());
  test.eq(markdowndoc.whfspath, doc.getElementById("whfspath")?.textContent, "Expect our whfspath to be in the source");

  const contentdiv = doc.getElementById("content");
  test.eq("Markdown file", contentdiv?.getElementsByTagName("h2")[0]?.textContent);
  test.eq("heading2", contentdiv?.getElementsByTagName("h2")[0]?.getAttribute("class"));
  const firstpara = contentdiv?.getElementsByTagName("p")[0];
  test.eq("This is a commonmark marked down file", firstpara?.textContent);
  test.eq("commonmark", firstpara?.getElementsByTagName("code")[0]?.textContent);
  test.eq("normal", firstpara?.getAttribute("class"));
  //FIXME also ensure proper classes on table and tr/td!
  test.eq("baz", contentdiv?.getElementsByTagName("td")[0]?.textContent);
  test.eq("bim", contentdiv?.getElementsByTagName("td")[1]?.textContent);
}

//Test SiteResponse. we look a lot like testRouter except that we're not really using the file we open but just need it to bootstrap SiteRequest
async function testSiteResponse() {
  //Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const sitereq = await buildSiteRequest(new WebRequest(markdowndoc.link), markdowndoc);

  //It should be okay to initialize the composer without knowing its tpye
  const outputpage = await sitereq.createComposer();
  test.assert(outputpage.pageconfig);

  //And if we know the type, we can access the pageconfig!
  const typedoutputpage = await sitereq.createComposer<BaseTestPageConfig>();
  test.eq("/webhare-tests/webhare_testsuite.testsitejs/TestPages/markdownpage", typedoutputpage.pageconfig.whfspath);

  typedoutputpage.appendHTML(`<p>This is a body!</p>`);
  const response = await typedoutputpage.finish();

  //Verify markdown contents
  const doc = parseHTMLDoc(await response.text());
  test.eq(markdowndoc.whfspath, doc.getElementById("whfspath")?.textContent, "Expect our whfspath to be in the source");
  const contentdiv = doc.getElementById("content");
  test.eq("This is a body!", contentdiv?.getElementsByTagName("p")[0]?.textContent);
  test.eq("text/html; charset=utf-8", response.getHeader("content-type"));

  //Verify the GTM plugin is present
  const config = getWHConfig(doc);
  test.eq({ "a": "GTM-TN7QQM", "h": true, "m": false }, config["socialite:gtm"]);
}

async function testCaptureJSDesign() {
  //Test capturing a JS WebDesign for reuse in a HareScript page
  const targetpage = await whfs.openFile("site::webhare_testsuite.testsitejs/webtools/pollholder");
  const resultpage = await captureJSDesign(targetpage.id);
  test.eq(2, resultpage.parts.length, "Expect two parts to be generated, for each side of the placeholder");
  test.eqMatch(/.*<html.*<body.*<div id="content"[^>]+> *$/, resultpage.parts[0].replaceAll("\n", " "));
  test.eqMatch(/^ *<\/div>.*\/body.*\/html/, resultpage.parts[1].replaceAll("\n", " "));
}

async function testCaptureJSRendered() {
  //Test capturing a JS Page rendered in a WHLIB design
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const resultpage = await captureJSPage(markdowndoc.id);
  // console.log(resultpage.body);
  test.eqMatch(/<html.*<body.*<div id="content".*<code>commonmark<\/code>.*<\/div>.*\/body.*\/html/, resultpage.body.replaceAll("\n", " "));
}

//Unlike testSiteResponse the testRouter_... tests actually attempt to render the markdown document *and* go through the path lookup motions
async function testRouter_HSWebDesign() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const result = await coreWebHareRouter(new WebRequest(markdowndoc.link));

  await verifyMarkdownResponse(markdowndoc, result);
}

async function testRouter_JSWebDesign() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const result = await coreWebHareRouter(new WebRequest(markdowndoc.link));

  await verifyMarkdownResponse(markdowndoc, result);
}

test.run([
  testSiteResponse,
  testCaptureJSDesign,
  testCaptureJSRendered,
  testRouter_HSWebDesign,
  testRouter_JSWebDesign
]);
