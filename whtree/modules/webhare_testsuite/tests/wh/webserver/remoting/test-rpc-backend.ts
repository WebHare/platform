import * as test from '@webhare/test';
import { HTTPMethod } from '@webhare/router';
import { WebHareBlob, backendConfig } from '@webhare/services';
import { parseTrace } from '@webhare/js-api-tools';
import type { WebRequestInfo } from '@mod-system/js/internal/types';
import { getSignedWHDebugOptions } from '@webhare/router/src/debug';
import type { testAPI } from '@mod-webhare_testsuite/js/rpcservice';
import { backendBase, initEnv } from '@webhare/env/src/envbackend';
import { DTAPStage } from '@webhare/env';
import { createRPCClient, type GetRPCClientInterface, type RPCResponse } from "@webhare/rpc-client";
import { RPCRouter } from "@mod-platform/js/services/rpc-router";
import { newWebRequestFromInfo } from '@webhare/router/src/request';
import { parseTyped } from '@webhare/std';
import { getTypedStringifyableData } from '@mod-webhare_testsuite/js/ci/testdata';

async function testRPCCaller() {
  const servicebaseurl = "http://127.0.0.1/.wh/rpc/webhare_testsuite/testapi/";
  const request: WebRequestInfo = {
    sourceip: "127.0.0.1",
    url: `${servicebaseurl}validateEmail`,
    headers: { "content-type": "application/json" },
    body: WebHareBlob.from(JSON.stringify(["nl", "pietje@webhare.net"])),
    method: HTTPMethod.POST
  };

  let call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(200, call.status);
  let res: RPCResponse = parseTyped(await call.text());
  test.assert(!("error" in res));
  test.eq(false, res.result);

  request.url = `${servicebaseurl}noSuchAPI`;
  request.body = WebHareBlob.from(JSON.stringify([]));
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(404, call.status);

  test.eq({ error: `Method 'noSuchAPI' not found` }, parseTyped(await call.text()));

  request.url = `${servicebaseurl}serverCrash`;
  request.body = WebHareBlob.from(JSON.stringify([]));
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(500, call.status);
  test.eq({ error: `Internal server error` }, parseTyped(await call.text()));

  //set etr to see more info
  const debugCookieData = getSignedWHDebugOptions({ debugFlags: { etr: true } });
  test.assert(debugCookieData);
  request.headers.cookie = `wh-debug=${encodeURIComponent(debugCookieData)} `;

  // Enable the 'etr' debug flag and see if we get a trace
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(500, call.status);
  res = parseTyped(await call.text()) as RPCResponse;
  test.assert("error" in res);
  test.eqPartial({ error: `this is a server crash` }, res);
  test.eq("Object.serverCrash", res.trace?.[0]?.func);

  // See if console logs are also recorded with the 'etr' flag
  request.url = `${servicebaseurl}doConsoleLog`;
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(200, call.status);
  res = parseTyped(await call.text()) as RPCResponse;
  test.eq(true, res.consoleLog?.some((item: any) => item.method === "log" && item.data === "This log statement was generated on the server by the TestNoAuthJS service\n"));

  // Set some cookies
  request.url = `${servicebaseurl}setCookies`;
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(200, call.status);
  res = parseTyped(await call.text()) as RPCResponse;
  test.assert(!("error" in res));

  test.eq(true, (res.result as any).cookiesSet);
  test.eq([
    "testcookie=124",
    "testcookie2=457"
  ], call.headers.getSetCookie());
}

async function testTypedClient() {
  const testAPIService = createRPCClient("webhare_testsuite:testapi");
  test.typeAssert<test.Equals<GetRPCClientInterface<"webhare_testsuite:testapi">, typeof testAPIService>>();
  test.typeAssert<test.Equals<GetRPCClientInterface<typeof testAPI>, typeof testAPIService>>();

  //These normally work out-of-the box as @webhare/env should be configured by the bootstrap
  test.eq(true, await testAPIService.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await testAPIService.validateEmail("en", "klaasje@beta.webhare.net"));

  test.eq([getTypedStringifyableData()], await testAPIService.echo(getTypedStringifyableData()));

  //Verify that modifying the base URL breaks them
  const save_backend_setting = backendBase;
  initEnv(DTAPStage.Development, "http://127.0.0.1:65500/");
  await test.throws(/fetch failed/, () => testAPIService.validateEmail("nl", "pietje@webhare.dev"));

  const myservice1 = testAPIService.withOptions({ baseUrl: backendConfig.backendURL });
  test.eq(true, await myservice1.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice1.validateEmail("en", "klaasje@beta.webhare.net"));

  const myservice2 = createRPCClient<typeof testAPI>(backendConfig.backendURL + ".wh/rpc/webhare_testsuite/testapi/");
  test.typeAssert<test.Equals<typeof testAPIService, typeof myservice2>>();
  test.typeAssert<test.Equals<Promise<void>, ReturnType<typeof myservice2.lockWork>>>();
  test.typeAssert<test.Equals<Promise<void>, ReturnType<typeof myservice2.serverCrash>>>(); //TODO this only works now because serverCrash is defined as :void but implicitly it would be :never

  test.eq(true, await myservice2.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice2.validateEmail("en", "klaasje@beta.webhare.net"));

  for (const withError of [false, true]) {
    const client = myservice1.withOptions({
      silent: true,
      onBeforeRequest: withError ? (url: URL) => url.searchParams.set("wh-debug", getSignedWHDebugOptions({ debugFlags: { etr: true } })) : undefined,
    });
    const err = await test.throws(withError ? /this is a server crash/ : /Internal server error/, client.serverCrash());

    //verify I can see client side always, but server side ONLY if etr is enabled
    const trace = parseTrace(err);
    test.eq(withError, trace.some(t => t.func === "Object.serverCrash"));
    test.eq(true, trace.some(t => t.func.includes("testTypedClient")));
  }

  const serviceWithHeaders = myservice1.withOptions({ headers: { "Authorization": "grizzly bearer" } });
  const serviceWithMoreHeaders = serviceWithHeaders.withOptions({ headers: { "X-Test": "test" } });
  test.eqPartial({ authorization: "grizzly bearer", "x-test": "test" }, (await serviceWithMoreHeaders.describeMyRequest()).requestHeaders);

  initEnv(DTAPStage.Development, save_backend_setting); //restore it just in case future tests rely on it

  //Test lock abandonment
  await testAPIService.lockWork();
  await testAPIService.lockWork();
}

test.runTests([
  testRPCCaller,
  testTypedClient
]);
