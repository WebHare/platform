import * as test from "@webhare/test";
import * as services from "@webhare/services";
import { HTTPMethod, WebRequest } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { decodeHSON } from "@webhare/hscompat/hscompat";

interface GetRequestDataResponse {
  method: string;
  webvars: Array<{ ispost: boolean; name: string; value: string }>;
}

async function testHSWebserver() {
  const testsuiteresources = services.config.backendurl + "tollium_todd.res/webhare_testsuite/tests/";
  let result = await coreWebHareRouter(new WebRequest(testsuiteresources + "getrequestdata.shtml"));
  test.eq(200, result.status);
  test.eq("application/x-hson", result.getHeader("content-type"));

  let response = decodeHSON(await result.text()) as unknown as GetRequestDataResponse;
  test.eq("GET", response.method);

  result = await coreWebHareRouter(new WebRequest(testsuiteresources + "getrequestdata.shtml", {
    method: HTTPMethod.POST,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "a=1&b=2"
  }));

  test.eq(200, result.status);
  test.eq("application/json", result.getHeader("content-type"));

  response = await result.json() as GetRequestDataResponse;
  test.eq("POST", response.method);
  test.eqProps([{ name: 'a', value: '1' }, { name: 'b', value: '2' }], response.webvars);

  //Get a binary file
  result = await coreWebHareRouter(new WebRequest(testsuiteresources + "rangetestfile.jpg"));
  //FIXME we also want a blob() interface - and that one to be smart enough to pipe-through huge responses
  test.eq("c72d48d291273215ba66fc473a4075de1de02f94", Buffer.from(await crypto.subtle.digest("SHA-1", await result.arrayBuffer())).toString('hex'));
}

async function testJSBackedURLs() {
  const baseurl = services.config.backendurl + ".webhare_testsuite/tests/js/";
  let fetchresult = await fetch(baseurl);
  let jsonresponse = await fetchresult.json();

  test.eq(400, fetchresult.status);
  test.eq("Invalid request", jsonresponse.error);

  fetchresult = await fetch(baseurl + "?type=debug");
  jsonresponse = await fetchresult.json();

  test.eq(200, fetchresult.status);
  test.eq(true, jsonresponse.debug);
  test.eq(baseurl + "?type=debug", jsonresponse.url);
}

test.run([
  testHSWebserver,
  testJSBackedURLs
]);
