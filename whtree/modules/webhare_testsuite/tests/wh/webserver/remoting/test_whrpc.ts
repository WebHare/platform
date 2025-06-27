/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh/testframework";
import RPCClient from '@mod-system/js/wh/rpc';
import * as testnoauthservice from "./testnoauthservice.rpc.json"; //explicitly test old non-?proxy syntax
import { createClient } from "@webhare/jsonrpc-client";

test.runTests(
  [
    "Basic rpc",
    async function () {
      const rpc = new RPCClient("webhare_testsuite:testnoauth");
      let controller = new AbortController;
      let call;

      //basic tests
      test.eq('Hi', await rpc.invoke('echo', 'Hi'));
      console.log(await rpc.invoke({ wrapresult: true }, 'echo', 'Hi'));
      test.eq({ status: 200, result: 'Hi', error: null, retryafter: null }, await rpc.invoke({ wrapresult: true }, 'echo', 'Hi'));
      test.eq(42, await rpc.invoke('echoany', 42));
      test.eq(null, await rpc.invoke('ireturnnothing'));

      //timeout test
      test.eq({ x: 42 }, await rpc.invoke('complexresultsslow', { x: 42 }));

      await test.throws(/^RPC Timeout:/, rpc.invoke({ timeout: 50 }, 'complexresultsslow', { x: 42 }));

      await test.throws(/^RPC Timeout:/, (new RPCClient("webhare_testsuite:testnoauth", { timeout: 50 })).invoke('complexresultsslow', { x: 42 }));

      controller = new AbortController;
      call = rpc.invoke({ signal: controller.signal }, 'complexresultsslow', { x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted$/, call);

      //now test mixing timeout and signal...
      controller = new AbortController;
      call = rpc.invoke({ timeout: 50, signal: controller.signal }, 'complexresultsslow', { x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted$/, call);

      controller = new AbortController;
      call = rpc.invoke({ timeout: 50, signal: controller.signal }, 'complexresultsslow', { x: 42 });
      await test.throws(/^RPC Timeout:/, call);

      //test a crash
      await test.throws(/^RPC Error: /, () => rpc.invoke('crashtest', 'abort'));
      await test.throws(/^RPC Error: /, () => rpc.invoke('crashtest', 'throw'));

      //test a weird response
      await test.throws(/^RPC Failed: /, () => rpc.invoke('crashtest', 'terminate'));
    },

    "Test rate limiting",
    async function () {
      const rpc = new RPCClient("webhare_testsuite:testnoauth");

      //if we listen for 429 explicitly, we'll hear it
      test.eq({ status: 200, result: { accepted: true }, error: null, retryafter: null }, await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));
      test.eq({ status: 429, result: null, error: null, retryafter: 1 }, await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));

      //but if we don't, things "just work"
      test.eq({ status: 200, result: { accepted: true }, error: null, retryafter: null }, await rpc.invoke({ wrapresult: true }, "testratelimit", { timeperiod: 200 }));
    },

    "Test setoptions",
    async function () {
      const rpc = new RPCClient("webhare_testsuite:testnoauth");
      test.eq({ x: 42 }, await rpc.invoke('complexresultsslow', { x: 42 }));

      rpc.setOptions({ timeout: 50 });
      await test.throws(/^RPC Timeout:/, (new RPCClient("webhare_testsuite:testnoauth", { timeout: 50 })).invoke('complexresultsslow', { x: 42 }));
    },

    "Use real URLS",
    async function () {
      const rpc = new RPCClient(location.origin + "/wh_services/webhare_testsuite/testnoauth");
      test.eq('Hi', await rpc.invoke('echo', 'Hi'));
    },

    "Use rpc.json",
    async function () {
      test.eq('Hi', await testnoauthservice.echo('Hi'));
      test.eq({ x: 42 }, await testnoauthservice.complexResultsSlow({ x: 42 }));
      test.eq({ x: 42 }, await testnoauthservice.invoke('complexResultsSlow', { x: 42 }));
      await test.throws(/^RPC Timeout:/, testnoauthservice.invoke({ timeout: 50 }, 'complexResultsSlow', { x: 42 }));

      //backwards compatibility... rpcResolve
      const call = testnoauthservice.complexResultsSlow({ x: 42 });
      testnoauthservice.rpcResolve(call, { aborted: true });
      test.eq({ aborted: true }, await call);
    },

    "Use new JSONRPCClient",
    async function () {
      const testnoauthclient = createClient("webhare_testsuite:testnoauth");
      test.eq('Hi', await testnoauthclient.echo('Hi'));
      test.eq({ x: 42 }, await testnoauthclient.complexResultsSlow({ x: 42 }));

      await test.throws(/^RPC Timeout:/, testnoauthclient.withOptions({ debug: true, timeout: 50 }).complexResultsSlow({ x: 42 }));

      const controller = new AbortController;
      const call = testnoauthclient.withOptions({ signal: controller.signal }).complexResultsSlow({ x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted/, call);
    }
  ]);
