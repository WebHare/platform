import * as test from "@webhare/test-frontend";
import type { testAPI } from '@mod-webhare_testsuite/js/rpcservice';
import { rpc } from "@webhare/rpc";
import { getTypedStringifyableData } from "@mod-webhare_testsuite/js/ci/testdata";

test.runTests(
  [
    "Basic rpc",
    async function () {
      const testAPIService = rpc("webhare_testsuite:testapi");
      let controller = new AbortController;
      let call;

      //basic tests
      test.eq(['Hi', 'everybody'], await testAPIService.echo('Hi', 'everybody'));
      test.eq(undefined, await testAPIService.iReturnNothing());
      test.eq([getTypedStringifyableData()], await testAPIService.echo(getTypedStringifyableData()));

      //timeout test
      test.eq([{ x: 42 }], await testAPIService.echoSlow({ x: 42 }));
      await test.throws(/^RPC Timeout:/, testAPIService.withOptions({ timeout: 50 }).echoSlow({ x: 42 }));

      controller = new AbortController;
      call = testAPIService.withOptions({ signal: controller.signal }).echoSlow({ x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted$/, call);

      //now test mixing timeout and signal...
      controller = new AbortController;
      call = testAPIService.withOptions({ timeout: 50, signal: controller.signal }).echoSlow({ x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted$/, call);

      controller = new AbortController;
      call = testAPIService.withOptions({ timeout: 50, signal: controller.signal }).echoSlow({ x: 42 });
      await test.throws(/^RPC Timeout:/, call);

      //test a crash
      await test.throws(/^RPC Error: /, () => testAPIService.withOptions({ silent: true }).serverCrash());

      //test origin url
      test.eq(location.href, (await testAPIService.describeMyRequest()).originURL);
    },

    /* FIXME rate limits
    "Test rate limiting",
    async function () {
      const rpc = new RPCClient("webhare_testsuite:testnoauth");

      //if we listen for 429 explicitly, we'll hear it
      test.eq({ status: 200, result: { accepted: true }, error: null, retryafter: null }, await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));
      test.eq({ status: 429, result: null, error: null, retryafter: 1 }, await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));

      //but if we don't, things "just work"
      test.eq({ status: 200, result: { accepted: true }, error: null, retryafter: null }, await rpc.invoke({ wrapresult: true }, "testratelimit", { timeperiod: 200 }));
    },*/


    "Use real URLS",
    async function () {
      test.throws(/end in a slash/, () => rpc<typeof testAPI>(location.origin + "/.wh/rpc//webhare_testsuite/testapi"));
      const client = rpc<typeof testAPI>(location.origin + "/.wh/rpc/webhare_testsuite/testapi/");
      test.eq(['Hi'], await client.echo('Hi'));
    }

  ]);
