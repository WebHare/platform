import { getCodeContext } from "@webhare/services/src/codecontexts";
import { createJSONResponse, HTTPErrorCode, HTTPSuccessCode, type RestRequest } from "@webhare/router";

type Options = { phase: "authorization" | "handler" | "none"; deny?: boolean; failCleanup?: boolean; failOperation?: boolean };
export function createProbe(options: Options) {
  if (process.env.WEBHARE_CI !== "1") throw new Error("Cleanup probes require synthetic CI");
  const probe = { ...options, id: crypto.randomUUID(), entered: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(), disposed: Promise.withResolvers<void>(), handlerCalls: 0, cleanupStarted: false,
    cleanupFailure: new Error("Synthetic OpenAPI cleanup failure"), operationFailure: new Error("Synthetic OpenAPI operation failure") };
  probes.set(probe.id, probe);
  return probe;
}
const probes = new Map<string, ReturnType<typeof createProbe>>();
export function removeProbe(id: string) { probes.delete(id); }

function probeFor(request: RestRequest) {
  const probe = probes.get(request.webRequest.headers.get("x-cleanup-probe") ?? "");
  if (!probe) throw new Error("Unknown synthetic cleanup probe");
  return probe;
}

function installCleanup(probe: ReturnType<typeof createProbe>) {
  const context = getCodeContext();
  // Observe the old dispatcher's detached close rejection without changing its ordering.
  const close = context.close.bind(context);
  context.close = () => {
    const pending = close();
    void pending.catch(() => { /* The dispatcher result is asserted separately. */ });
    return pending;
  };
  context.ensureScopedResource("webhare_testsuite:openapi-cleanup", () => true, async () => {
    probe.cleanupStarted = true;
    probe.entered.resolve();
    try {
      await probe.release.promise;
      if (probe.failCleanup) throw probe.cleanupFailure;
    } finally { probe.disposed.resolve(); }
  });
}

export async function authorize(request: RestRequest) {
  const probe = probeFor(request);
  if (probe.phase === "authorization") installCleanup(probe);
  return probe.deny ? { authorized: false as const,
    response: createJSONResponse(HTTPErrorCode.Unauthorized, { denied: true }) }
    : { authorized: true as const, authorization: { actor: "synthetic" } };
}

export async function handle(request: RestRequest) {
  const probe = probeFor(request);
  probe.handlerCalls++;
  if (probe.phase === "handler") installCleanup(probe);
  if (probe.failOperation) throw probe.operationFailure;
  return createJSONResponse(HTTPSuccessCode.Ok, { ok: true });
}
