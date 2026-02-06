import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as services from "@webhare/services";
import { HTTPMethod, createRedirectResponse } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { decodeHSON } from "@webhare/hscompat/src/hscompat";
import { IncomingWebRequest, newForwardedWebRequest, newWebRequestFromInfo } from "@webhare/router/src/request";

interface GetRequestDataResponse {
  method: string;
  webvars: Array<{ ispost: boolean; name: string; value: string }>;
}

async function testRouterAPIs() {
  {
    const redirect = createRedirectResponse("https://www.webhare.dev/");
    test.eq(303, redirect.status);
    test.eq("https://www.webhare.dev/", redirect.headers.get("location"));
  }

  {
    const redirect = createRedirectResponse({ type: "redirect", url: "https://www.webhare.dev/" });
    test.eq(303, redirect.status);
    test.eq("https://www.webhare.dev/", redirect.headers.get("location"));
  }

  //Test getOriginURL
  const baseinfo = { sourceip: '127.0.0.1', body: services.WebHareBlob.from(''), method: HTTPMethod.POST, url: "https://www.example.net/subpage/?page=123", headers: {} };
  test.eq('https://www.example.net/suburl', (await newWebRequestFromInfo({ ...baseinfo })).getOriginURL('/suburl'));
  test.eq('https://www.example.net/suburl', (await newWebRequestFromInfo({ ...baseinfo })).getOriginURL('suburl'));
  test.eq('https://www.example.com/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite" } })).getOriginURL('suburl'));
  test.eq('https://www.example.org/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", origin: "https://www.example.org" } })).getOriginURL('suburl'));
  test.eq('https://www.example.org/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", ORIGIN: "https://www.example.org" } })).getOriginURL('/suburl'));
  test.eq(null, (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", ORIGIN: "https://www.example.org" } })).getOriginURL('https://nu.nl'));
}

function testWebRequest() {
  let req = new IncomingWebRequest(services.backendConfig.backendURL);
  test.eq(services.backendConfig.backendURL, req.url.toString());
  test.eq(services.backendConfig.backendURL, req.baseURL);
  test.eq("", req.localPath);

  req = new IncomingWebRequest(services.backendConfig.backendURL + "sub%20URL/dir/f?hungry4=Spicy");
  const searchParams = new URL(req.url).searchParams;
  test.eq("Spicy", searchParams.get("hungry4"));
  test.eq(null, searchParams.get("Hungry4"), "On the JS side we're case sensitive");
  test.eq(services.backendConfig.backendURL, req.baseURL);
  test.eq("sub url/dir/f", req.localPath);

  test.throws(/original base/, () => newForwardedWebRequest(req, "sub URL/"));
  test.throws(/original base/, () => newForwardedWebRequest(req, "sub url/"));
  test.throws(/original base/, () => newForwardedWebRequest(req, "sub%20url/"));
  test.throws(/search/, () => newForwardedWebRequest(req, "sub%20URL/dir/f?hungry4"));

  const req2 = newForwardedWebRequest(req, "sub%20URL/");
  const searchParams2 = new URL(req2.url).searchParams;
  test.eq("Spicy", searchParams2.get("hungry4"));
  test.eq(services.backendConfig.backendURL + "sub%20URL/", req2.baseURL);
  test.eq("dir/f", req2.localPath);

  const req3 = newForwardedWebRequest(req2, "dir/");
  const searchParams3 = new URL(req2.url).searchParams;
  test.eq("Spicy", searchParams3.get("hungry4"));
  test.eq(services.backendConfig.backendURL + "sub%20URL/dir/", req3.baseURL);
  test.eq("f", req3.localPath);
}

async function testHSWebserver() {
  const { port, clientIp, localAddress } = await test.getTestWebserver("webhare_testsuite:basicrouter");
  test.assert(port);
  const testsuiteresources = services.backendConfig.backendURL + "tollium_todd.res/webhare_testsuite/tests/";
  let result = await coreWebHareRouter(port, new IncomingWebRequest(testsuiteresources + "getrequestdata.shtml", {
    clientIp,
  }), localAddress);
  test.eq(200, result.status);
  test.eq("application/x-hson", result.headers.get("content-type"));

  let response = decodeHSON(await result.text()) as unknown as GetRequestDataResponse;
  test.eq("GET", response.method);

  result = await coreWebHareRouter(port, new IncomingWebRequest(testsuiteresources + "getrequestdata.shtml", {
    clientIp,
    method: HTTPMethod.POST,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new TextEncoder().encode("a=1&b=2").buffer as ArrayBuffer //TS5.7 workaround
  }), localAddress);

  test.eq(200, result.status);
  test.eq("application/json", result.headers.get("content-type"));

  const clonedResult = result.clone();

  response = await result.json() as GetRequestDataResponse;
  test.eq("POST", response.method);
  test.eqPartial([{ name: 'a', value: '1' }, { name: 'b', value: '2' }], response.webvars);

  const response2 = await clonedResult.json() as GetRequestDataResponse;
  test.eq("POST", response2.method);
  test.eqPartial([{ name: 'a', value: '1' }, { name: 'b', value: '2' }], response2.webvars);

  //Get a binary file
  result = await coreWebHareRouter(port, new IncomingWebRequest(testsuiteresources + "rangetestfile.jpg", {
    clientIp
  }), localAddress);
  //FIXME we also want a blob() interface - and that one to be smart enough to pipe-through huge responses
  test.eq("c72d48d291273215ba66fc473a4075de1de02f94", Buffer.from(await crypto.subtle.digest("SHA-1", await result.arrayBuffer())).toString('hex'));
}

async function testJSBackedURLs() {
  const baseURL = services.backendConfig.backendURL + ".webhare_testsuite/tests/js/";
  let fetchresult = await fetch(baseURL);
  let jsonresponse = await fetchresult.json();

  test.eq(400, fetchresult.status);
  test.eq("Invalid request", jsonresponse.error);

  fetchresult = await fetch(baseURL + "?type=debug");
  jsonresponse = await fetchresult.json();
  test.eq(200, fetchresult.status);
  test.eq(true, jsonresponse.debug);
  test.eq(baseURL + "?type=debug", jsonresponse.url);
  test.eq(baseURL, jsonresponse.baseURL);
  test.eq("", jsonresponse.localPath);

  fetchresult = await fetch(baseURL + "?type=cookies");
  test.eq([
    "testcookie=123",
    "testcookie2=456"
  ], fetchresult.headers.getSetCookie());

  fetchresult = await fetch(baseURL + "Sub%20Url?type=debug");
  jsonresponse = await fetchresult.json();

  test.eq(baseURL + "Sub%20Url?type=debug", jsonresponse.url);
  test.eq(baseURL, jsonresponse.baseURL);
  test.eq("sub url", jsonresponse.localPath);

  fetchresult = await fetch(baseURL + "Sub%20Url?type=debug", { method: "post", headers: { "x-test": "42" }, body: "a=1&b=2" });
  jsonresponse = await fetchresult.json();
  test.eq(baseURL + "Sub%20Url?type=debug", jsonresponse.url);
  test.eq(baseURL, jsonresponse.baseURL);
  test.eq("sub url", jsonresponse.localPath);
  test.eq("42", jsonresponse.headers["x-test"]);
  test.eq("a=1&b=2", jsonresponse.text);

  fetchresult = await fetch(baseURL + "?type=redirect", { redirect: "manual" });
  test.eq(301, fetchresult.status);
  test.eq("https://www.webhare.dev/", fetchresult.headers.get("location"));

  const mixedcase_baseUrl = services.backendConfig.backendURL + ".webhare_Testsuite/TESTs/js/";
  fetchresult = await fetch(mixedcase_baseUrl + "Sub%20Url?type=debug");
  jsonresponse = await fetchresult.json();

  test.eq(mixedcase_baseUrl + "Sub%20Url?type=debug", jsonresponse.url);
  test.eq(mixedcase_baseUrl, jsonresponse.baseURL);
  test.eq("sub url", jsonresponse.localPath);

  //Follow an ambiguous URL due to a caller having its own opinion about URL encoding
  //TODO It would be nice to be able to support it in the JS webserver, but HS webserver mangles the URL too much
  const badbaseUrl = services.backendConfig.backendURL + ".webhare_testsuite/tests/j%73/"; //%73=s
  fetchresult = await fetch(badbaseUrl + "Sub%20Url?type=debug");
  test.eq(400, fetchresult.status);

  const tosubmit = new FormData;
  tosubmit.append("field1", "value1");
  tosubmit.append("field2", new File(["this is a text blob"], "testfile.txt", { type: "text/plain" }));
  fetchresult = await fetch(baseURL + "?type=formdata", {
    method: "POST",
    body: tosubmit
  });
  test.eq({
    contentType: /multipart\/form-data/,
    values: [
      { field: 'field1', value: 'value1' },
      {
        field: 'field2',
        value: `File: testfile.txt - ${Buffer.from("this is a text blob").toString("base64")}`
      }
    ]
  }, await fetchresult.json());
}

test.runTests([
  testRouterAPIs,
  testWebRequest,
  testHSWebserver,
  testJSBackedURLs
]);
