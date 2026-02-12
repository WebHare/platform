import * as test from '@webhare/test';
import { getJSONApiCaller } from '@mod-system/js/internal/jsonrpccaller';
import noAuthJSService from '@mod-webhare_testsuite/js/jsonrpc/client';
import { HTTPMethod } from '@webhare/router';
import { WebHareBlob, backendConfig } from '@webhare/services';
import { parseTrace } from '@webhare/js-api-tools';
import type { WebRequestInfo } from '@mod-system/js/internal/types';
import { getSignedWHDebugOptions } from '@webhare/router/src/debug';
import type { MyService } from '@mod-webhare_testsuite/js/jsonrpc/type';
import { createClient } from "@webhare/jsonrpc-client";
import { backendBase, initEnv } from '@webhare/env/src/envbackend';

async function testRPCCaller() {
  const servicedef = { service: "mod::webhare_testsuite/js/jsonrpc/service.ts#TestNoAuthJS" };
  const request: WebRequestInfo = {
    sourceip: "127.0.0.1",
    url: "http://127.0.0.1/test",
    headers: {},
    body: WebHareBlob.from(JSON.stringify({ id: 5, method: "validateEmail", params: ["nl", "pietje@webhare.net"] })),
    method: HTTPMethod.POST,
    binding: 0,
    webserver: 0
  };

  let callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
  test.eq(200, callres.status);
  test.eq(false, JSON.parse(await callres.body.text()).result);
  test.eq(null, JSON.parse(await callres.body.text()).error, "It must be null if there was no error.");

  {
    request.body = WebHareBlob.from(JSON.stringify({ id: 42, method: "noSuchAPI", params: [] }));
    callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
    test.eq(404, callres.status);

    const { debug: debugData, ...result } = JSON.parse(await callres.body.text());
    void (debugData);
    test.eq({ id: 42, error: { code: -32601, message: `Method 'noSuchAPI' not found` }, result: null }, result);
  }

  {
    request.body = WebHareBlob.from(JSON.stringify({ id: 42, method: "toString", params: [] }));
    callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
    test.eq(404, callres.status);

    const { debug: debugData, ...result } = JSON.parse(await callres.body.text());
    void (debugData);
    test.eq({ id: 42, error: { code: -32601, message: `Method 'toString' not found` }, result: null }, result);
  }

  request.body = WebHareBlob.from(JSON.stringify({ id: 77, method: "serverCrash", params: [] }));
  callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
  test.eq(500, callres.status);

  test.eqPartial({ id: 77, error: { code: -32000, message: `Internal error` }, result: null }, JSON.parse(await callres.body.text()));

  const debugCookieData = getSignedWHDebugOptions({ debugFlags: { etr: true } });
  test.assert(debugCookieData);
  request.headers.cookie = `wh-debug=${encodeURIComponent(debugCookieData)}`;

  // Enable the 'etr' debug flag and see if we get a trace
  callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
  test.eq(500, callres.status);
  let resultBody = JSON.parse(await callres.body.text());
  test.eqPartial({ id: 77, error: { code: -32000, message: `this is a server crash`, data: {} }, result: null }, resultBody);
  test.eq("TestNoAuthJS.serverCrash", resultBody.error.data.trace[0].func);

  // See if console logs are also recorded with the 'etr' flag
  request.body = WebHareBlob.from(JSON.stringify({ id: 42, method: "doConsoleLog", params: [] }));
  callres = await getJSONApiCaller().runJSONAPICall(servicedef, request);
  test.eq(200, callres.status);
  resultBody = JSON.parse(await callres.body.text());
  test.eq(true, resultBody.debug?.consoleLog?.some((item: any) => item.method === "log" && item.data === "This log statement was generated on the server by the TestNoAuthJS service\n"));
}

async function testTypedClient() {
  //These normally work out-of-the box as @webhare/env should be configured by the bootstrap
  test.eq(true, await noAuthJSService.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await noAuthJSService.validateEmail("en", "klaasje@beta.webhare.net"));

  //Verify that modifying the base URL breaks them
  const save_backend_setting = backendBase;
  initEnv("development", "http://127.0.0.1:65500/");
  await test.throws(/fetch failed/, () => noAuthJSService.validateEmail("nl", "pietje@webhare.dev"));

  const myservice1 = noAuthJSService.withOptions({ baseUrl: backendConfig.backendURL });
  test.eq(true, await myservice1.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice1.validateEmail("en", "klaasje@beta.webhare.net"));

  const myservice2 = createClient<MyService>(backendConfig.backendURL + "wh_services/webhare_testsuite/testnoauthjs");
  test.typeAssert<test.Equals<Promise<void>, ReturnType<typeof myservice2.serverCrash>>>();

  test.eq(true, await myservice2.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice2.validateEmail("en", "klaasje@beta.webhare.net"));

  for (const withError of [false, true]) {
    const urlappend = withError ? `?wh-debug=${encodeURIComponent(getSignedWHDebugOptions({ debugFlags: { etr: true } }))}` : '';
    const err = await test.throws(withError ? /this is a server crash/ : /Internal error/, myservice1.withOptions({ silent: true, urlappend }).serverCrash());

    //verify I can see client side always, but server side ONLY if etr is enabled
    const trace = parseTrace(err);
    test.eq(withError, trace.some(t => t.func === "TestNoAuthJS.serverCrash"));
    test.eq(true, trace.some(t => t.func.includes("testTypedClient")));
  }

  const serviceWithHeaders = myservice1.withOptions({ headers: { "Authorization": "grizzly bearer" } });
  const serviceWithMoreHeaders = serviceWithHeaders.withOptions({ headers: { "X-Test": "test" } });
  test.eqPartial({ authorization: "grizzly bearer", "x-test": "test" }, (await serviceWithMoreHeaders.describeMyRequest()).requestHeaders);

  initEnv("development", save_backend_setting); //restore it just in case future tests rely on it

  //Test lock abandonment
  await noAuthJSService.lockWork();
  await noAuthJSService.lockWork();
}

test.runTests([
  testRPCCaller,
  testTypedClient
]);
