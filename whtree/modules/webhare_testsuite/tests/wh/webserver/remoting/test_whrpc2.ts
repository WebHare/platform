import * as test from "@webhare/test";
import { createClient } from "@webhare/jsonrpc-client";
import noAuthJSService from '@mod-webhare_testsuite/js/jsonrpc/client';

test.runTests(
  [
    "Use new JSONRPCClient in TS context",
    async function () {
      const testnoauthclient = createClient("webhare_testsuite:testnoauth");

      test.eq('Hi', await testnoauthclient.echo('Hi'));
      test.eq({ x: 42 }, await testnoauthclient.complexResultsSlow({ x: 42 }));

      //Verify even an unknown client is known to return Promiwes
      const echoResult = testnoauthclient.echo('Hi 2');
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      echoResult satisfies Promise<any>;

      // @ts-expect-error -- this shouldn't be valid
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      echoResult satisfies string;

      await test.throws(/^RPC Timeout:/, testnoauthclient.withOptions({ debug: true, timeout: 50 }).complexResultsSlow({ x: 42 }));

      const controller = new AbortController;
      const call = testnoauthclient.withOptions({ signal: controller.signal }).complexResultsSlow({ x: 42 });
      controller.abort();
      await test.throws(/^RPC Aborted/, call);
    },

    "Test typed client",
    async function () {
      test.eq(true, await noAuthJSService.validateEmail("nl", "pietje@webhare.dev"));
      test.eq(false, await noAuthJSService.validateEmail("en", "klaasje@beta.webhare.net"));
    }

  ]);
