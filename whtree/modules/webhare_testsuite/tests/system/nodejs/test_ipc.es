/* globals describe it */
"use strict";

const { createDeferred } = require('@mod-system/js/internal/tools.js');
const assert = require("assert");

async function assertAsyncThrown(promise_returning_function, message)
{
  let notthrown=false;
  try
  {
    await promise_returning_function();
    notthrown=true;
  }
  catch(e)
  {
    return e;
  }
  assert(!notthrown, message || "Expected an async function to throw");
}

describe("Connect to bridge", function()
{
  const bridge = require('@mod-system/js/wh/bridge');
  it("should fail against unknown service", async function()
  {
    await bridge.connect({ debug: false });
    await assertAsyncThrown(x=>bridge.connectIPCPort('webhare_testsuite:testipc', false), "testipc shouldn't exist and connectIPCport should throw");
  });
  it("should connect with webhare_testsuite:ipc and ping it", async function()
  {
    let listenport = await bridge.createIPCPort('webhare_testsuite:testipc', false);
    let acceptpromise = createDeferred();
    listenport.on('accept', port => { acceptpromise.resolve(port); });

    let connectingport = await bridge.connectIPCPort('webhare_testsuite:testipc', false);
    let acceptedport = await acceptpromise.promise;

    let messagepromise = createDeferred();
    acceptedport.on('message', msg => messagepromise.resolve(msg));
    connectingport.send({ bericht: "Moi!" });
    let result = await messagepromise.promise;

    if(!result.bericht || result.bericht != 'Moi!')
      throw new Error("Received invalid message");
  });
  it("should test a simple invoke", async function()
  {
    let result = await bridge.invoke("module::webhare_testsuite/webservicetest.whlib", "ITakeNoParams");
    assert.strictEqual(42,result);
  });
  it("should not mind being closed", async function()
  {
    bridge.close();
    await assertAsyncThrown(x=>bridge.invoke("module::webhare_testsuite/webservicetest.whlib", "ITakeNoParams"), "bridge is closed so function should throw");
  });
});
