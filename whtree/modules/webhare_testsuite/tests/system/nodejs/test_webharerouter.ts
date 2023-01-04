import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";
import { WebRequest, WebResponse, WebHareRouter } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";

//TODO should this be a router API?  but will there ever be another router to run than coreWebHareRouter? is this more about caching ?
async function runARouter(router: WebHareRouter, request: WebRequest) {
  const response = new WebResponse;
  await router(request, response);

  return response.getFinalPage();
}

async function testRouter() {
  const markdowndoc = await whfs.openFile("site::webhare_testsuite.testsite/testpages/markdownpage");
  const result = await runARouter(coreWebHareRouter, new WebRequest("GET", markdowndoc.link));
  //FIXME noone asked for <h2 id="markdown-file">Markdown file</h2> - we want class="heading2" and we need to check how WebHare would generate these IDs. (RTD compatibility)
  test.eqMatch(/<html>.*<h2.*>Markdown file<\/h2>/, result.body);
}

test.run([testRouter]);
