import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { type StackTrace, parseTrace } from "@webhare/js-api-tools";
import { debugFlags } from "@webhare/env";
import { getOriginURL, type RPCContext, type WebRequest, type WebResponse } from "@webhare/router";
import { createRPCResponse, HTTPErrorCode, HTTPSuccessCode, RPCError } from "@webhare/router/src/response";
import { loadJSExport } from "@webhare/services/src/resourcetools";
import { parseTyped } from "@webhare/std";
import type { RPCResponse } from "@webhare/rpc/src/rpc-client";
import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";
import { logError } from "@webhare/services";
import type { TypedServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { getRequestUser } from "@webhare/wrd";

const MaxRPCArguments = 16;

function getDebugData(error?: unknown) {
  const trace: StackTrace = error && typeof error === "object" && "stack" in error ? parseTrace(error as Error) : [];
  return {
    consoleLog: getCodeContext().consoleLog.map(log => ({ ...log, when: log.when.toISOString() })),
    // TODO reenable as soon as we have a practical use case (not too fond of spamming servicemanager.log with even more data)
    // context: {
    //   id: getCodeContext().id,
    //   metadata: getCodeContext().metadata,
    // },
    trace: trace?.length ? trace : undefined
  };
}

export async function RPCRouter(req: WebRequest): Promise<WebResponse> {
  const { 1: module, 2: service, 3: method } = req.url.match(/https?:\/\/[^:]+\/\.wh\/rpc\/([^/?]+)\/([^/>]+)\/([^/?]+)/) || [];
  if (!module || !service || !method)
    return createRPCResponse(HTTPErrorCode.BadRequest, { error: "Invalid request" });

  const serviceName = `${module}:${service}`;
  const matchservice = getExtractedConfig("services").rpcServices.find((s) => s.name === serviceName);
  if (!matchservice)
    return createRPCResponse(HTTPErrorCode.NotFound, { error: `Service '${serviceName}' not found` });

  await using context = new CodeContext("rpc", {
    module, service, method
  });

  context.applyDebugSettings(req.getDebugSettings());

  return await context.run(() => runCall(req, matchservice, method));
}

async function runCall(req: WebRequest, matchservice: TypedServiceDescriptor, method: string) {
  const showerrors = debugFlags.etr;

  let params;
  try {
    const text = await req.text(); //TODO can we stream this so we won't even attempt to allocate over maxBodySize
    // We'll do the more expensive check (Buffer.byteLength) only if you might be close
    if (text.length > matchservice.maxBodySize || (text.length > matchservice.maxBodySize / 2 && Buffer.byteLength(text) > matchservice.maxBodySize))
      return createRPCResponse(HTTPErrorCode.BadRequest, { error: `Request body too large` });

    params = parseTyped(text) as unknown[];
    if (!Array.isArray(params))
      return createRPCResponse(HTTPErrorCode.BadRequest, { error: `Request body must be an array` });
    if (params.length > MaxRPCArguments)
      return createRPCResponse(HTTPErrorCode.BadRequest, { error: `Too many arguments` });

  } catch (e) {
    return createRPCResponse(HTTPErrorCode.BadRequest, { error: "Invalid request body" });
  }

  try {
    const api = await loadJSExport(matchservice.api) as Record<string, (context: RPCContext, ...args: unknown[]) => unknown | Promise<unknown>>;
    if (!api[method])
      throw new RPCError(HTTPErrorCode.NotFound, `Method '${method}' not found`);

    const responseHeaders = new Headers();
    const context = {
      request: req,
      getOriginURL: () => getOriginURL(req, new URL(req.url).searchParams.get("pathname") ?? "/") || null,
      getRequestUser: async () => (await getRequestUser(req, new URL(req.url).searchParams.get("pathname") ?? "/"))?.user || null,
      responseHeaders
    };

    const result = await api[method](context, ...params);
    const retval: RPCResponse = { result, ...(showerrors ? getDebugData() : {}) };
    return createRPCResponse(HTTPSuccessCode.Ok, retval, { headers: responseHeaders });
  } catch (e) {
    const debug = showerrors ? getDebugData(e) : undefined;
    if (e instanceof RPCError)
      return createRPCResponse(e.status, { error: e.message, ...debug } satisfies RPCResponse);
    else {
      logError(e as Error);
      return createRPCResponse(HTTPErrorCode.InternalServerError, (showerrors ? { error: (e as Error).message, ...debug } : { error: "Internal server error" }) satisfies RPCResponse);
    }
  }
}
