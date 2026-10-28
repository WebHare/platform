import * as test from "@webhare/test";
import { getWorkerRestAPIHandler, LogInfo } from "@mod-system/js/internal/openapi/restapi";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { createProbe, removeProbe } from "./data/openapi-cleanup";

function dispatcher() {
  const ref = "mod::webhare_testsuite/tests/system/nodejs/data/openapi-cleanup.ts";
  const response = { description: "Synthetic response", content: { "application/json": { schema: { type: "object" } } } } as const;
  return getWorkerRestAPIHandler("synthetic-cleanup", [{ path: ["probe"], params: [], methods: { GET: {
    handler: `${ref}#handle`, authorization: `${ref}#authorize`, params: [], requestBody: null,
    responses: { "200": response, "401": response }, inputValidation: ["always"], outputValidation: ["always"]
  } } }], null, null, null);
}

function start(handler: ReturnType<typeof dispatcher>, probe: ReturnType<typeof createProbe>) {
  const req = new IncomingWebRequest("http://cleanup.invalid/probe", { headers: { "x-cleanup-probe": probe.id } });
  const state = { settled: false };
  const result = handler.handleRequestInternal(req.encodeForTransfer().value, "probe", new LogInfo("127.0.0.1", "GET"))
    .then(value => { state.settled = true; return { value, error: undefined }; },
      (error: unknown) => { state.settled = true; return { value: undefined, error }; });
  return { state, result };
}

async function lifecycle(options: Parameters<typeof createProbe>[0]) {
  const probe = createProbe(options), pending = start(dispatcher(), probe);
  try {
    await test.wait(probe.entered.promise, "Actual OpenAPI dispatcher entered resource disposal");
    await new Promise<void>(resolve => setImmediate(resolve));
    test.eq(false, pending.state.settled, "Dispatcher must join cleanup before resolving or rejecting");
    if (probe.phase === "authorization") test.eq(0, probe.handlerCalls, "Handler waits for authorization cleanup");
    probe.release.resolve();
    const outcome = await pending.result;
    if (probe.failOperation && probe.failCleanup) {
      test.assert(outcome.error instanceof SuppressedError, "Both operation and disposal failures remain visible");
      test.eq(probe.cleanupFailure, outcome.error.error);
      test.eq(probe.operationFailure, outcome.error.suppressed);
    } else if (probe.failCleanup) {
      test.eq(probe.cleanupFailure, outcome.error);
      if (probe.phase === "authorization") test.eq(0, probe.handlerCalls, "Failed authorization cleanup cannot dispatch a handler");
    } else {
      test.eq(undefined, outcome.error);
      test.eq(probe.deny ? 401 : 200, outcome.value!.status);
    }
  } finally {
    probe.release.resolve();
    await pending.result;
    if (probe.cleanupStarted) await probe.disposed.promise;
    removeProbe(probe.id);
  }
}

async function independentRequestsStillProgress() {
  const handler = dispatcher();
  const held = createProbe({ phase: "authorization" }), free = createProbe({ phase: "none" });
  const first = start(handler, held);
  try {
    await test.wait(held.entered.promise, "First authorizer is disposing");
    const next = await test.wait(start(handler, free).result, "An unrelated request remains runnable");
    test.eq(200, next.value!.status);
    test.eq(1, free.handlerCalls);
    test.eq(0, held.handlerCalls);
    test.eq(false, first.state.settled);
  } finally {
    held.release.resolve();
    await first.result;
    if (held.cleanupStarted) await held.disposed.promise;
    removeProbe(held.id); removeProbe(free.id);
  }
}

const tests = {
  authorizationDrain: () => lifecycle({ phase: "authorization" }),
  authorizationDenialDrain: () => lifecycle({ phase: "authorization", deny: true }),
  handlerDrain: () => lifecycle({ phase: "handler" }),
  authorizationCleanupFailure: () => lifecycle({ phase: "authorization", failCleanup: true }),
  handlerCleanupFailure: () => lifecycle({ phase: "handler", failCleanup: true }),
  combinedFailures: () => lifecycle({ phase: "handler", failOperation: true, failCleanup: true }),
  independentRequestsStillProgress
};
const only = process.env.OPENAPI_CLEANUP_ONLY;
if (only && !Object.hasOwn(tests, only)) throw new Error(`Unknown OpenAPI cleanup regression: ${only}`);
test.runTests(Object.entries(tests).filter(([name]) => !only || name === only).map(([name, body]) => async () => {
  console.log(`OPENAPI_CLEANUP_TEST ${name}`);
  await body();
}));
