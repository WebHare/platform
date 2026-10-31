import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as services from "@webhare/services";
import { createEphemeralEndpoint, createJSONResponse, createRedirectResponse, createWebResponse, getAssetPackIntegrationCode } from "@webhare/router";
import { coreWebHareRouter } from "@webhare/router/src/corerouter";
import { decodeHSON } from "@webhare/hscompat/src/hscompat";
import { IncomingWebRequest, newForwardedWebRequest, newWebRequestFromInfo } from "@webhare/router/src/request";
import type { WebRequestInfo } from "@mod-system/js/internal/types";
import { listLocks } from "@mod-platform/js/bridge/tools";
import { generateRandomId } from "@webhare/std";
import { litty } from "@webhare/litty";
import { endPointRouter } from "@mod-platform/js/endpoints/endpoints";

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
  const baseinfo: WebRequestInfo = { sourceip: '127.0.0.1', body: services.WebHareBlob.from(''), method: "POST", url: "https://www.example.net/subpage/?page=123", headers: {}, binding: 0, webserver: 0 };
  test.eq('https://www.example.net/suburl', (await newWebRequestFromInfo({ ...baseinfo })).getOriginURL('/suburl'));
  test.eq('https://www.example.net/suburl', (await newWebRequestFromInfo({ ...baseinfo })).getOriginURL('suburl'));
  test.eq('https://www.example.com/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite" } })).getOriginURL('suburl'));
  test.eq('https://www.example.org/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", origin: "https://www.example.org" } })).getOriginURL('suburl'));
  test.eq('https://www.example.org/suburl', (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", ORIGIN: "https://www.example.org" } })).getOriginURL('/suburl'));
  test.eq(null, (await newWebRequestFromInfo({ ...baseinfo, headers: { referer: "https://www.example.com/somesite", ORIGIN: "https://www.example.org" } })).getOriginURL('https://nu.nl'));

  //Test getAssetPackIntegrationCode
  test.eq(`<link rel="stylesheet" href="/.wh/ea/ap/platform.tollium/ap.css"><script src="/.wh/ea/ap/platform.tollium/ap.mjs" async type="module"></script>`,
    getAssetPackIntegrationCode("platform:tollium"));
  test.eq(`<link rel="stylesheet" href="/!123/.wh/ea/ap/platform.tollium/ap.css"><script src="/!123/.wh/ea/ap/platform.tollium/ap.mjs" async type="module"></script>`,
    getAssetPackIntegrationCode("platform:tollium", { cacheBuster: "123" }));
  test.eq(`<link rel="stylesheet" href="https://beta.webhare.net/.wh/ea/ap/platform.tollium/ap.css"><script src="https://beta.webhare.net/.wh/ea/ap/platform.tollium/ap.mjs" crossorigin="anonymous" async type="module"></script>`,
    getAssetPackIntegrationCode("platform:tollium", { designRoot: "https://beta.webhare.net/" }));
  test.eq(`<link rel="stylesheet" href="https://beta.webhare.net/!456/.wh/ea/ap/platform.tollium/ap.css"><script src="https://beta.webhare.net/!456/.wh/ea/ap/platform.tollium/ap.mjs" crossorigin="anonymous" async type="module"></script>`,
    getAssetPackIntegrationCode("platform:tollium", { designRoot: "https://beta.webhare.net/", cacheBuster: "456" }));
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

async function testWebResponse() {
  const littyResponse = createWebResponse(litty`<html><p>Hello ${"<b>world</b>"}</p></html>`);
  test.eq(`<html><p>Hello &lt;b&gt;world&lt;/b&gt;</p></html>`, await littyResponse.text());
}

async function testEphemeralEndpoints() {
  using endpoint = await createEphemeralEndpoint(async request => {
    const action = new URL(request.url).searchParams.get("action");
    switch (action) {
      case "echo":
        return createWebResponse(await request.blob(), {
          status: 201,
          headers: [
            ["content-type", "application/octet-stream"],
            ["x-callback", "echo"],
            ["set-cookie", "first=1; Path=/"],
            ["set-cookie", "second=2; Path=/"]
          ]
        });
      case "redirect":
        return createRedirectResponse("https://www.webhare.dev/");
      case "empty":
        return createWebResponse(undefined, { status: 204 });
      case "fail":
        if (request.method !== "HEAD")
          throw new Error("Ephemeral endpoint failure");
        break;
    }
    if (request.method === "HEAD")
      return createWebResponse(undefined, { status: 204 });
    return createJSONResponse(200, {
      method: request.method,
      url: request.url,
      baseURL: request.baseURL,
      localPath: request.localPath,
      clientIp: request.clientIp,
      clientWebServer: request.clientWebServer,
      header: request.headers.get("x-test"),
      cookie: request.getCookie("callback"),
      body: await request.text()
    });
  });

  test.eq(services.backendConfig.backendURL, endpoint.url.substring(0, services.backendConfig.backendURL.length));
  test.eq(/^\.wh\/endpoints\/ephemeral\/[A-Za-z0-9_-]+$/, endpoint.url.substring(services.backendConfig.backendURL.length));
  const response = await fetch(endpoint.url + "?value=Test", {
    headers: { "x-test": "MixedCase", cookie: "callback=CookieValue" }
  });
  test.eq(200, response.status);
  test.eqPartial({
    method: "GET",
    url: endpoint.url + "?value=Test",
    baseURL: endpoint.url + "/",
    localPath: "",
    header: "MixedCase",
    cookie: "CookieValue",
    body: ""
  }, await response.json());

  const subrouteURL = endpoint.url + "/Sub%20Route/Nested?value=Test";
  const subrouteResponse = await fetch(subrouteURL);
  test.eq(200, subrouteResponse.status);
  test.eqPartial({
    url: subrouteURL,
    baseURL: endpoint.url + "/",
    localPath: "sub route/nested"
  }, await subrouteResponse.json());

  const rootResponse = await fetch(endpoint.url + "/");
  test.eq(200, rootResponse.status);
  test.eqPartial({
    baseURL: endpoint.url + "/",
    localPath: ""
  }, await rootResponse.json());

  const posted = await fetch(endpoint.url, { method: "POST", body: "Callback body" });
  test.eq(200, posted.status);
  test.eqPartial({ method: "POST", body: "Callback body" }, await posted.json());

  const directRequest = newForwardedWebRequest(new IncomingWebRequest(endpoint.url, {
    clientIp: "192.0.2.123",
    clientWebServer: 42
  }), ".wh/endpoints/");
  const directResponse = await endPointRouter(directRequest);
  test.eqPartial({
    baseURL: endpoint.url + "/",
    localPath: "",
    clientIp: "192.0.2.123",
    clientWebServer: 42
  }, await directResponse.json());

  const bodies = [[0, 255, 128, 13, 10], [1, 2, 3], []];
  await Promise.all(bodies.map(async body => {
    const echoed = await fetch(endpoint.url + "?action=echo", {
      method: "POST",
      body: new Uint8Array(body)
    });
    test.eq(201, echoed.status);
    test.eq("application/octet-stream", echoed.headers.get("content-type"));
    test.eq("echo", echoed.headers.get("x-callback"));
    test.eq(["first=1; Path=/", "second=2; Path=/"], echoed.headers.getSetCookie());
    test.eq(body, [...new Uint8Array(await echoed.arrayBuffer())]);
  }));

  const redirect = await fetch(endpoint.url + "?action=redirect", { redirect: "manual" });
  test.eq(303, redirect.status);
  test.eq("https://www.webhare.dev/", redirect.headers.get("location"));
  for (const method of ["GET", "HEAD"]) {
    const empty = await fetch(endpoint.url + "?action=empty", { method });
    test.eq(204, empty.status);
    test.eq("", await empty.text());
  }
  await test.throws(/Ephemeral endpoint failure/, endPointRouter(new IncomingWebRequest(endpoint.url + "?action=fail")));

  let disposedURL;
  {
    using otherEndpoint = await createEphemeralEndpoint(async () => createWebResponse("Other endpoint"));
    disposedURL = otherEndpoint.url;
    test.assert(otherEndpoint.url !== endpoint.url);
    test.eq("Other endpoint", await (await fetch(otherEndpoint.url)).text());
  }
  test.eq(503, (await fetch(disposedURL)).status);

  endpoint.close();
  endpoint.close();
  test.eq(503, (await fetch(endpoint.url)).status);
  test.eq(503, (await fetch(`${services.backendConfig.backendURL}.wh/endpoints/ephemeral/${generateRandomId()}`)).status);

  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  using pendingEndpoint = await createEphemeralEndpoint(async () => {
    started.resolve();
    await finish.promise;
    return createWebResponse("Finished");
  });
  const pendingResponse = fetch(pendingEndpoint.url);
  try {
    await started.promise;
    pendingEndpoint.close();
    test.eq(503, (await pendingResponse).status);
  } finally {
    finish.resolve();
  }
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
    method: "POST",
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

async function testNonVhost() {
  //Test with non-vhosted IP addresses. These require different URL calculations
  const directLocalhost = await test.createWebServer({ hostname: "localhost" });
  const baseURL = directLocalhost.baseURL + ".webhare_testsuite/tests/js/"; //handled by mod::webhare_testsuite/web/tests/js/testrouter.ts
  const debugInfoURL = baseURL + "?type=debug";
  const fetchresult = await fetch(debugInfoURL).then(_ => _.json());
  test.eq(debugInfoURL, fetchresult.url);
}

async function testRequestSeparation() {
  const baseURL = services.backendConfig.backendURL + ".webhare_testsuite/tests/js/";

  const mutexBaseName = "webhare_testsuite:testrequestseparation_" + generateRandomId().toLowerCase();
  const lock1 = await services.lockMutex(mutexBaseName + "_post");
  const fetch1 = fetch(baseURL + "?type=worktest&postmutexname=" + encodeURIComponent(mutexBaseName) + "_post");

  //Wait for fetch1 to lock its mutex - it will do this *after* beginWork
  const raceResult1 = await Promise.race([
    test.wait(async () => (await listLocks()).mutexes.find(lock => lock.mutexname === mutexBaseName + "_post")?.waiters === 1).then(() => null),
    fetch1
  ]);
  test.eq(null, raceResult1);

  //Prepare fetch2. Stop it before beginWork
  const lock2 = await services.lockMutex(mutexBaseName + "_pre");
  const fetch2 = fetch(baseURL + "?type=worktest&premutexname=" + encodeURIComponent(mutexBaseName) + "_pre");

  const raceResult2 = await Promise.race([
    test.wait(async () => (await listLocks()).mutexes.find(lock => lock.mutexname === mutexBaseName + "_pre")?.waiters === 1).then(() => null),
    fetch2
  ]);
  test.eq(null, raceResult2);

  //Release fetch2, it should hang in beginWork (TODO Could we verify *that* instead?)
  lock2.release();
  await test.sleep(100); //will hopefully do

  //Release fetch1
  lock1.release();
  test.eq(200, (await fetch1).status);

  //Release fetch2
  lock2.release();
  test.eq(200, (await fetch2).status);
}


test.runTests([
  testRouterAPIs,
  testWebRequest,
  testWebResponse,
  testEphemeralEndpoints,
  testHSWebserver,
  testJSBackedURLs,
  testNonVhost,
  testRequestSeparation
]);
