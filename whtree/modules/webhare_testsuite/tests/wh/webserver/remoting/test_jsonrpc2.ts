import * as test from '@webhare/test';
import { JSONAPICall } from '@mod-system/js/internal/jsonrpccaller';
import noAuthJSService from '@mod-webhare_testsuite/js/jsonrpc/client';
import { HTTPMethod } from '@webhare/router';
import { WebHareBlob, backendConfig } from '@webhare/services';
import { parseTrace } from '@webhare/js-api-tools';
import { WebRequestInfo } from '@mod-system/js/internal/types';
import { getSignedWHDebugOptions } from '@webhare/router/src/debug';

async function testRPCCaller() {
  const servicedef = { service: "mod::webhare_testsuite/js/jsonrpc/service.ts#TestNoAuthJS" };
  const request: WebRequestInfo = {
    sourceip: "127.0.0.1",
    url: "http://127.0.0.1/test",
    headers: {},
    body: WebHareBlob.from(JSON.stringify({ id: 5, method: "validateEmail", params: ["nl", "pietje@webhare.net"] })),
    method: HTTPMethod.POST
  };

  let callres = await JSONAPICall(servicedef, request);
  test.eq(200, callres.status);
  test.eq(false, JSON.parse(await callres.body.text()).result);
  test.eq(null, JSON.parse(await callres.body.text()).error, "It must be null if there was no error.");

  request.body = WebHareBlob.from(JSON.stringify({ id: 42, method: "noSuchAPI", params: [] }));
  callres = await JSONAPICall(servicedef, request);
  test.eq(404, callres.status);

  test.eq({ id: 42, error: { code: -32601, message: `Method 'noSuchAPI' not found` }, result: null }, JSON.parse(await callres.body.text()));

  request.body = WebHareBlob.from(JSON.stringify({ id: 77, method: "serverCrash", params: [] }));
  callres = await JSONAPICall(servicedef, request);
  test.eq(500, callres.status);

  //TODO - *with* `etr` debugflag, the error message should be revealed. But we can't set that flag yet in JS tests
  //test.eq({ id: 77, error: { code: -32000, message: `this is a server crash` }, result: null }, JSON.parse(await callres.body.text()));
  test.eqProps({ id: 77, error: { code: -32000, message: `this is a server crash` }, result: null }, JSON.parse(await callres.body.text()));

  const debugCookieData = getSignedWHDebugOptions({ debugFlags: { etr: true } });
  test.assert(debugCookieData);
  request.headers.cookie = `wh-debug=${encodeURIComponent(debugCookieData)}`;

  // Enable the 'etr' debug flag and see if we get a trace
  callres = await JSONAPICall(servicedef, request);
  test.eq(500, callres.status);
  let resultBody = JSON.parse(await callres.body.text());
  test.eqProps({ id: 77, error: { code: -32000, message: `this is a server crash`, data: {} }, result: null }, resultBody);
  test.eq("TestNoAuthJS.serverCrash", resultBody.error.data.trace[0].func);

  // See if console logs are also recorded with the 'etr' flag
  request.body = WebHareBlob.from(JSON.stringify({ id: 42, method: "doConsoleLog", params: [] }));
  callres = await JSONAPICall(servicedef, request);
  test.eq(200, callres.status);
  resultBody = JSON.parse(await callres.body.text());
  test.eq(true, resultBody.debug?.consoleLog?.some((item: any) => item.func == "log" && item.data == "my console log\n"));
}

async function testTypedClient() {
  const myservice = noAuthJSService.withOptions({ baseUrl: backendConfig.backendURL });
  test.eq(true, await myservice.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await myservice.validateEmail("en", "klaasje@beta.webhare.net"));

  const err = await test.throws(/this is a server crash/, myservice.serverCrash());
  const trace = parseTrace(err);
  //verify I can see client and server side
  test.assert(trace.find(t => t.func === "TestNoAuthJS.serverCrash"));
  test.assert(trace.find(t => t.func.includes("testTypedClient")));

  const serviceWithHeaders = myservice.withOptions({ headers: { "Authorization": "grizzly bearer" } });
  const serviceWithMoreHeaders = serviceWithHeaders.withOptions({ headers: { "X-Test": "test" } });
  test.eqProps({ authorization: "grizzly bearer", "x-test": "test" }, (await serviceWithMoreHeaders.describeMyRequest()).requestHeaders);

}

test.run([
  testRPCCaller,
  testTypedClient
]);
