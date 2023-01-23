import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { WebRequest, WebResponse, WebHareRouter, SiteRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { BaseTestPageConfig } from "@mod-webhare_testsuite/webdesigns/basetestjs/webdesign/webdesign";

//Test SiteResponse. we look a lot like testRouter except that we're not really using the file we open but just need it to bootstrap SiteRequest
async function testSiteResponse() {
  //Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsitejs/testpages/markdownpage");
  const sitereq = new SiteRequest(new WebRequest("GET", markdowndoc.link), markdowndoc);

  const response = new WebResponse;

  //It should be okay to initialize the composer without knowing its tpye
  const outputpage = await sitereq.createComposer(response);
  test.assert(outputpage.pageconfig);

  //And if we know the type, we can access the pageconfig!
  const typedoutputpage = await sitereq.createComposer<BaseTestPageConfig>(response);
  test.eq("/webhare-tests/webhare_testsuite.testsitejs/TestPages/markdownpage", typedoutputpage.pageconfig.whfspath);

  typedoutputpage.appendHTML(`<p>This is a body!</p>`);
  await typedoutputpage.finish();

  const page = response.getFinalPage();
  test.eqMatch(/<html>.*<body>.*<p>This is a body!<\/p><\/body><\/html>/, page.body);
  test.eq("text/html; charset=utf-8", page.headers["content-type"]);
}

//TODO should this be a router API?  but will there ever be another router to run than coreWebHareRouter? is this more about caching ?
async function runARouter(router: WebHareRouter, request: WebRequest) {
  //Unlike testSiteResponse we actually attempt to render the markdown document *and* go through the path lookup motions
  const response = new WebResponse;
  await router(request, response);

  return response.getFinalPage();
}

async function testRouter() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const result = await runARouter(coreWebHareRouter, new WebRequest("GET", markdowndoc.link));

  //FIXME noone asked for <h2 id="markdown-file">Markdown file</h2> - we want class="heading2" and we need to check how WebHare would generate these IDs. (RTD compatibility)
  test.eqMatch(/<html.*>.*<h2.*>Markdown file<\/h2>/, result.body);
}

test.run([
  testSiteResponse,
  testRouter
]);
