import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import * as services from "@webhare/services";
import { WebRequest, WebResponse, SiteRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { BaseTestPageConfig } from "@mod-webhare_testsuite/webdesigns/basetestjs/webdesign/webdesign";
import { XMLParser } from "fast-xml-parser";
import { captureJSDesign, captureJSPage } from "@mod-publisher/js/internal/capturejsdesign";

function parseHTMLDoc(html: string) {
  const parsingOptions = {
    ignoreAttributes: false,
    unpairedTags: ["hr", "br", "link", "meta", "img"],
    stopNodes: ["*.pre", "*.script"],
    processEntities: true,
    htmlEntities: true,
    //convert about everything but known unique tags to arrays..
    isArray: (name: string, jpath: unknown, isLeafNode: boolean, isAttribute: boolean) => !isAttribute && !["html", "head", "body", "main", "thead", "tbody"].includes(name)
  };
  const parser = new XMLParser(parsingOptions);
  return parser.parse(html);
}

function verifyMarkdownResponse(markdowndoc: whfs.WHFSObject, response: WebResponse) {
  const doc = parseHTMLDoc(response.body);
  const whfspathnode = doc.html.body.div.find((_: any) => _["@_id"] === "whfspath");
  test.eq(markdowndoc.whfspath, whfspathnode["#text"], "Expect our whfspath to be in the source");

  const contentdiv = doc.html.body.div.find((_: any) => _["@_id"] === "content");

  test.eq("Markdown file", contentdiv.h2[0]["#text"]); //it has an id= so this one currently becomes an object
  test.eq("heading2", contentdiv.h2[0]["@_class"]); //it has an id= so this one currently becomes an object
  test.eq("This is amarked down file", contentdiv.p[0]["#text"]);
  test.eq(["commonmark"], contentdiv.p[0].code);
  test.eq("normal", contentdiv.p[0]["@_class"]);
  //FIXME also ensure proper classes on table and tr/td!
  test.eq(["baz", "bim"], contentdiv.table[0].tbody.tr[0].td);
}


//Test SiteResponse. we look a lot like testRouter except that we're not really using the file we open but just need it to bootstrap SiteRequest
async function testSiteResponse() {
  //Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const sitereq = new SiteRequest(new WebRequest(markdowndoc.link), markdowndoc);

  //It should be okay to initialize the composer without knowing its tpye
  const outputpage = await sitereq.createComposer();
  test.assert(outputpage.pageconfig);

  //And if we know the type, we can access the pageconfig!
  const typedoutputpage = await sitereq.createComposer<BaseTestPageConfig>();
  test.eq("/webhare-tests/webhare_testsuite.testsitejs/TestPages/markdownpage", typedoutputpage.pageconfig.whfspath);

  typedoutputpage.appendHTML(`<p>This is a body!</p>`);
  const response = await typedoutputpage.finish();

  //Verify markdown contents
  const doc = parseHTMLDoc(response.body);
  test.eq("whfspath", doc.html.body.div[0]["@_id"]);
  test.eq(markdowndoc.whfspath, doc.html.body.div[0]["#text"], "Expect our whfspath to be in the source");
  const contentdiv = doc.html.body.div.find((_: any) => _["@_id"] === "content");
  test.eq("This is a body!", contentdiv.p[0]);
  test.eq("text/html; charset=utf-8", response.getHeader("content-type"));
}

async function testCaptureJSDesign() {
  //Test capturing a JS WebDesign for reuse in a HareScript page
  const targetpage = await whfs.openFile("site::webhare_testsuite.testsitejs/webtools/pollholder");
  const resultpage = await captureJSDesign(targetpage.id);
  test.eq(2, resultpage.parts.length, "Expect two parts to be generated, for each side of the placeholder");
  test.eqMatch(/<html.*<body.*<div id="content">$/, resultpage.parts[0].replaceAll("\n", " "));
  test.eqMatch(/^ *<\/div>.*\/body.*\/html/, resultpage.parts[1].replaceAll("\n", " "));
}

async function testCaptureJSRendered() {
  //Test capturing a JS Page rendered in a WHLIB design
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const resultpage = await captureJSPage(markdowndoc.id);
  // console.log(resultpage.body);
  test.eqMatch(/<html.*<body.*<div id="content">.*<code>commonmark<\/code>.*<\/div>.*\/body.*\/html/, resultpage.body.replaceAll("\n", " "));
}

//Unlike testSiteResponse the testRouter_... tests actually attempt to render the markdown document *and* go through the path lookup motions
async function testRouter_HSWebDesign() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const result = await coreWebHareRouter(new WebRequest(markdowndoc.link));

  verifyMarkdownResponse(markdowndoc, result);
}

async function testRouter_JSWebDesign() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const result = await coreWebHareRouter(new WebRequest(markdowndoc.link));

  verifyMarkdownResponse(markdowndoc, result);
}

test.run([
  services.ready,
  testSiteResponse,
  testCaptureJSDesign,
  testCaptureJSRendered,
  testRouter_HSWebDesign,
  testRouter_JSWebDesign
]);
