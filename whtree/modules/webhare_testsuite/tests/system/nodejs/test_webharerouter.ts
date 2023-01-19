import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { WebRequest, WebResponse, WebHareRouter, SiteRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";

async function testComposedResponse() {
  //Create a SiteRequest so we have context for a SiteResponse
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const sitereq = new SiteRequest(new WebRequest("GET", markdowndoc.link), markdowndoc);

  const response = new WebResponse;
  const outputpage = await sitereq.createComposer(response);

  outputpage.appendHTML(`<p>This is a body!</p>`);
  outputpage.flush();

  const page = response.getFinalPage();
  test.eqMatch(/<html>.*<body>.*<p>This is a body!<\/p><\/body><\/html>/, page.body);
  test.eq("text/html; charset=utf-8", page.headers["content-type"]);
}

//TODO should this be a router API?  but will there ever be another router to run than coreWebHareRouter? is this more about caching ?
async function runARouter(router: WebHareRouter, request: WebRequest) {
  const response = new WebResponse;
  await router(request, response);

  return response.getFinalPage();
}

async function testRouter() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  //FIXME are we still happy with the 'WebDesign' name? reevaluate whether something else might make more sense

  const result = await runARouter(coreWebHareRouter, new WebRequest("GET", markdowndoc.link));
  //FIXME noone asked for <h2 id="markdown-file">Markdown file</h2> - we want class="heading2" and we need to check how WebHare would generate these IDs. (RTD compatibility)
  test.eqMatch(/<html>.*<h2.*>Markdown file<\/h2>/, result.body);
}

test.run([
  testComposedResponse,
  testRouter
]);
