import * as test from '@webhare/test';
import * as services from '@webhare/services';
import { JSONAPICall } from '@mod-system/js/internal/jsonrpccaller';

async function testRPCCaller() {
  await services.ready();

  const callres = await JSONAPICall({ service: "mod::webhare_testsuite/js/jsonrpc/service.ts#TestNoAuthJS" },
    {
      url: "",
      headers: [],
      body: JSON.stringify({ id: 5, method: "validateEmail", params: ["nl", "pietje@webhare.net"] })

    });
  test.eq(200, callres.statusCode);
  test.eq(false, JSON.parse(callres.body).result);
}

test.run([testRPCCaller]);
