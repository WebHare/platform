import * as test from '@webhare/test-backend';
import { HTTPMethod } from '@webhare/router';
import { WebHareBlob, backendConfig } from '@webhare/services';
import { parseTrace } from '@webhare/js-api-tools';
import type { WebRequestInfo } from '@mod-system/js/internal/types';
import { getSignedWHDebugOptions } from '@webhare/router/src/debug';
import type { testAPI, TestApiValidateEmail } from '@mod-webhare_testsuite/js/rpcservice';
import { backendBase, initEnv } from '@webhare/env/src/envbackend';
import { rpc, type GetRPCClientInterface, type OmitRPCContextArgs, type RPCResponse } from "@webhare/rpc";
import { RPCRouter } from "@mod-platform/js/services/rpc-router";
import { newWebRequestFromInfo } from '@webhare/router/src/request';
import { parseTyped } from '@webhare/std';
import { getTypedStringifyableData } from '@mod-webhare_testsuite/js/ci/testdata';
import { createFirstPartyToken } from '@webhare/auth';
import { WRDSchema } from '@webhare/wrd';
import type { Platform_BasewrdschemaSchemaType } from '@mod-platform/generated/wrd/webhare';
import { runInWork } from '@webhare/whdb';
import { testschemaSchema } from 'wh:wrd/webhare_testsuite';

const jsAuthSchema = new WRDSchema<Platform_BasewrdschemaSchemaType>("webhare_testsuite:testschema");

async function prep() {
  await test.reset({ wrdSchema: "webhare_testsuite:testschema" });
  await runInWork(() => testschemaSchema.updateSchema({ accountType: "wrdPerson" }));
}

async function testRPCCaller() {
  const servicebaseurl = "http://127.0.0.1/.wh/rpc/webhare_testsuite/testapi/";
  const request: WebRequestInfo = {
    sourceip: "127.0.0.1",
    url: `${servicebaseurl}validateEmail`,
    headers: { "content-type": "application/json" },
    body: WebHareBlob.from(JSON.stringify(["nl", "pietje@webhare.net"])),
    method: HTTPMethod.POST,
    binding: 0,
    webserver: 0
  };

  let call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(200, call.status);
  let res: RPCResponse = parseTyped(await call.text());
  test.assert(!("error" in res));
  test.eq(false, res.result);

  call = await RPCRouter(await newWebRequestFromInfo({ ...request, url: request.url.replace('127.0.0.1', '127.0.0.1:8000') }));
  test.eq(200, call.status);
  res = parseTyped(await call.text());
  test.assert(!("error" in res));
  test.eq(false, res.result);

  request.url = `${servicebaseurl}noSuchAPI`;
  request.body = WebHareBlob.from(JSON.stringify([]));
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(404, call.status);

  test.eq({ error: `Method 'noSuchAPI' not found` }, parseTyped(await call.text()));

  // What happens if we invoke prototype methods?
  request.url = `${servicebaseurl}toString`;
  call = await RPCRouter(await newWebRequestFromInfo(request));
  test.eq(404, call.status);
  test.eq({ error: `Method 'toString' not found` }, parseTyped(await call.text()));

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
  const testAPIService = rpc("webhare_testsuite:testapi");
  test.typeAssert<test.Equals<GetRPCClientInterface<"webhare_testsuite:testapi">, typeof testAPIService>>();
  test.typeAssert<test.Equals<GetRPCClientInterface<OmitRPCContextArgs<typeof testAPI>>, typeof testAPIService>>();
  test.typeAssert<test.Equals<GetRPCClientInterface<OmitRPCContextArgs<typeof testAPI>>["validateEmail"], TestApiValidateEmail["validateEmail"]>>();

  const reboundService = testAPIService.withOptions({});
  test.typeAssert<test.Equals<typeof testAPIService, typeof reboundService>>();
  test.assert(reboundService);

  //These normally work out-of-the box as @webhare/env should be configured by the bootstrap
  test.eq(true, await testAPIService.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await testAPIService.validateEmail("en", "klaasje@beta.webhare.net"));

  test.eq([getTypedStringifyableData()], await testAPIService.echo(getTypedStringifyableData()));

  await test.throws(/Request body too large/, () => testAPIService.echo({ huge: "Huge!".repeat(65536 / "Huge!".length) }));
  await test.throws(/Too many arguments/, () => testAPIService.echo(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17));

  //Verify login/authorization
  test.eq({ user: "" }, await testAPIService.validateLoggedinUser());
  const caller = await runInWork(() => jsAuthSchema.insert("wrdPerson", { wrdFirstName: "The", wrdLastName: "Caller" }));
  const idToken = await createFirstPartyToken(jsAuthSchema, "id", caller);

  const authService = testAPIService.withOptions({ headers: { "authorization": "bearer " + idToken.accessToken } });
  test.eq({ user: "The Caller" }, await authService.validateLoggedinUser());

  //Verify that modifying the base URL breaks them
  const save_backend_setting = backendBase;
  initEnv("development", "http://127.0.0.1:65500/");
  await test.throws(/fetch failed/, () => testAPIService.validateEmail("nl", "pietje@webhare.dev"));

  const myservice1 = testAPIService.withOptions({ baseUrl: backendConfig.backendURL });
  test.eq(true, await myservice1.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice1.validateEmail("en", "klaasje@beta.webhare.net"));

  const myservice2 = rpc<OmitRPCContextArgs<typeof testAPI>>(backendConfig.backendURL + ".wh/rpc/webhare_testsuite/testapi/");
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

  const myservice3 = rpc<TestApiValidateEmail>(backendConfig.backendURL + ".wh/rpc/webhare_testsuite/testapi/");
  test.eq(true, await myservice3.validateEmail("nl", "pietje@webhare.dev"));

  const serviceWithHeaders = myservice1.withOptions({ headers: { "Authorization": "grizzly bearer" } });
  const serviceWithMoreHeaders = serviceWithHeaders.withOptions({ headers: { "X-Test": "test" } });
  test.eqPartial({ authorization: "grizzly bearer", "x-test": "test" }, (await serviceWithMoreHeaders.describeMyRequest()).requestHeaders);

  initEnv("development", save_backend_setting); //restore it just in case future tests rely on it

  //Test lock abandonment
  await testAPIService.lockWork();
  await testAPIService.lockWork();

  // Pretend it's a promise and await it. The proxy shouldn't be confused by this or we will break returning rpc objects from async functions
  const checkSafelyAwaitable = await (testAPIService as unknown as Promise<typeof testAPIService>);
  test.eq(["pietje@webhare.dev"], await checkSafelyAwaitable.echo("pietje@webhare.dev"));
}

async function testUntypedClient() {
  const testAPIService = rpc<any>(`${backendConfig.backendURL}.wh/rpc/webhare_testsuite/testapi/`);

  //Verify even an unknown client is known to return Promises
  const echoResult = testAPIService.echo(getTypedStringifyableData());
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  echoResult satisfies Promise<any>;

  // @ts-expect-error -- this shouldn't be valid
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  echoResult satisfies string;

  test.eq([getTypedStringifyableData()], await echoResult);
}


async function testFilter() {
  const etrRpc = rpc("webhare_testsuite:testapi", {
    silent: true,
    onBeforeRequest: (url: URL) => url.searchParams.set("wh-debug", getSignedWHDebugOptions({ debugFlags: { etr: true } })),
  });

  await test.throws(/Intercepted/, () => etrRpc.withOptions({ headers: { "filter": "throw" } }).echo(1));
  test.eq([-43], await etrRpc.echo(-42));
  //@ts-expect-error As far as TS knows, this shouldn't happen. It's up to the filter implementor to *not* break call compatibility
  test.eq(undefined, await etrRpc.echo(-43));
}

test.runTests([
  prep,
  testRPCCaller,
  testTypedClient,
  testUntypedClient,
  testFilter
]);
