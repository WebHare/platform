import * as test from "@mod-system/js/wh/testframework";
import RPCClient from '@mod-system/js/wh/rpc';
import * as testnoauthservice from "./testnoauthservice.rpc.json";

test.registerTests(
 [ "Basic rpc"
 , async function()
   {
     let rpc = new RPCClient("webhare_testsuite:testnoauth");
     let controller = new AbortController;
     let exc;
     let call;

     //basic tests
     test.eq('Hi', await rpc.invoke('echo','Hi'));
     console.log(await rpc.invoke({wrapresult:true}, 'echo', 'Hi'));
     test.eq({ status: 200, result: 'Hi', error: null, retryafter: null }, await rpc.invoke({wrapresult:true}, 'echo', 'Hi'));
     test.eq(42, await rpc.invoke('echoany',42));
     test.eq(null, await rpc.invoke('ireturnnothing'));

     //timeout test
     test.eq({ x:42 }, await rpc.invoke('complexresultsslow', { x:42 }));

     exc = await test.throws(rpc.invoke({timeout: 50}, 'complexresultsslow', { x:42 }));
     test.eqMatch(/^RPC Timeout:/, exc.message);

     exc = await test.throws((new RPCClient("webhare_testsuite:testnoauth", {timeout:50})).invoke('complexresultsslow', { x:42 }));
     test.eqMatch(/^RPC Timeout:/, exc.message);

     controller = new AbortController;
     call = rpc.invoke({ signal:controller.signal}, 'complexresultsslow', { x:42 });
     controller.abort();
     exc = await test.throws(call);
     test.eqMatch(/^RPC Aborted$/, exc.message);

     //now test mixing timeout and signal...
     controller = new AbortController;
     call = rpc.invoke({ timeout:50, signal:controller.signal}, 'complexresultsslow', { x:42 });
     controller.abort();
     exc = await test.throws(call);
     test.eqMatch(/^RPC Aborted$/, exc.message);

     controller = new AbortController;
     call = rpc.invoke({ timeout:50, signal:controller.signal}, 'complexresultsslow', { x:42 });
     exc = await test.throws(call);
     test.eqMatch(/^RPC Timeout:/, exc.message);

     //test a crash
     exc = await test.throws(() => rpc.invoke('crashtest','abort'));
     test.eqMatch(/^RPC Error: /, exc.message);

     exc = await test.throws(() => rpc.invoke('crashtest','throw'));
     test.eqMatch(/^RPC Error: /, exc.message);

     //test a weird response
     exc = await test.throws(() => rpc.invoke('crashtest','terminate'));
     test.eqMatch(/^RPC Failed: /, exc.message);
   }

 , "Test rate limiting"
 , async function()
   {
     let rpc = new RPCClient("webhare_testsuite:testnoauth");

     //if we listen for 429 explicitly, we'll hear it
     test.eq({ status: 200, result: { accepted: true} , error: null, retryafter: null }, await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));
     test.eq({ status: 429, result: null, error: null, retryafter: 1 },                  await rpc.invoke({ wrapresult: true, retry429: false }, "testratelimit", { timeperiod: 200 }));

     //but if we don't, things "just work"
     test.eq({ status: 200, result: { accepted: true} , error: null, retryafter: null }, await rpc.invoke({ wrapresult: true }, "testratelimit", { timeperiod: 200 }));
   }

 , "Test setoptions"
 , async function()
   {
     let rpc = new RPCClient("webhare_testsuite:testnoauth");
     test.eq({ x:42 }, await rpc.invoke('complexresultsslow', { x:42 }));

     rpc.setOptions({timeout:50});
     let exc = await test.throws((new RPCClient("webhare_testsuite:testnoauth", {timeout:50})).invoke('complexresultsslow', { x:42 }));
     test.eqMatch(/^RPC Timeout:/, exc.message);
   }

 , "Use real URLS"
 , async function()
   {
     let rpc = new RPCClient(location.origin + "/wh_services/webhare_testsuite/testnoauth");
     test.eq('Hi', await rpc.invoke('echo','Hi'));
   }

 , "Use rpc.json"
 , async function()
   {
     test.eq('Hi', await testnoauthservice.echo('Hi'));
     test.eq({ x:42 }, await testnoauthservice.complexResultsSlow({ x:42 }));
     test.eq({ x:42 }, await testnoauthservice.invoke('complexResultsSlow', {x:42 }));
     let exc = await test.throws(testnoauthservice.invoke({timeout:50},'complexResultsSlow', {x:42 }));
     test.eqMatch(/^RPC Timeout:/, exc.message);

     //backwards compatibility... rpcResolve
     let call = testnoauthservice.complexResultsSlow({ x:42 });
     testnoauthservice.rpcResolve(call, {aborted:true});
     test.eq({aborted:true}, await call);

   }
]);
