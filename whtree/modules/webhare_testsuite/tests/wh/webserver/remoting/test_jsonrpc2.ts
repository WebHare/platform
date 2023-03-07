import * as test from '@webhare/test';
import * as services from '@webhare/services';
import { JSONAPICall } from '@mod-system/js/internal/jsonrpccaller';
import noAuthJSService from '@mod-webhare_testsuite/js/jsonrpc/client';
import { HTTPMethod } from '@webhare/router';

async function testRPCCaller() {
  await services.ready();
  const servicedef = { service: "mod::webhare_testsuite/js/jsonrpc/service.ts#TestNoAuthJS" };
  const request = {
    url: "",
    headers: {},
    body: JSON.stringify({ id: 5, method: "validateEmail", params: ["nl", "pietje@webhare.net"] }),
    method: HTTPMethod.POST
  };

  let callres = await JSONAPICall(servicedef, request);
  test.eq(200, callres.status);
  test.eq(false, JSON.parse(callres.body).result);
  test.eq(null, JSON.parse(callres.body).error, "It must be null if there was no error.");

  request.body = JSON.stringify({ id: 42, method: "noSuchAPI", params: [] });
  callres = await JSONAPICall(servicedef, request);
  test.eq(404, callres.status);

  test.eq({ id: 42, error: { code: -32601, message: `Method 'noSuchAPI' not found` }, result: null }, JSON.parse(callres.body));

  request.body = JSON.stringify({ id: 77, method: "serverCrash", params: [] });
  callres = await JSONAPICall(servicedef, request);
  test.eq(500, callres.status);

  //TODO - *with* `etr` debugflag, the error message should be revealed. But we can't set that flag yet in JS tests
  //test.eq({ id: 77, error: { code: -32000, message: `this is a server crash` }, result: null }, JSON.parse(callres.body));
  test.eq({ id: 77, error: { code: -32000, message: `Internal error` }, result: null }, JSON.parse(callres.body));
}

async function testTypedClient() {
  await services.ready();
  test.eq(true, await noAuthJSService.validateEmail("nl", "pietje@webhare.dev"));
  test.eq(false, await noAuthJSService.validateEmail("en", "klaasje@beta.webhare.net"));
}

test.run([
  testRPCCaller,
  testTypedClient
]);
