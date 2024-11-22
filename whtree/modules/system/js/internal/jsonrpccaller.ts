import { HTTPErrorCode, createJSONResponse, WebResponse, HTTPSuccessCode } from "@webhare/router";
import * as services from "@webhare/services";
import { WebRequestInfo, WebResponseInfo } from "./types";
import { StackTrace, parseTrace, } from "@webhare/js-api-tools";
import { debugFlags } from "@webhare/env/src/envbackend";
import type { RequestID, JSONRPCErrorResponse } from "@webhare/jsonrpc-client/src/jsonrpc-client";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";
import { ConsoleLogItem, Serialized } from "@webhare/env/src/concepts";
import { makeJSObject } from "./resourcetools";

/*
Status codes

Code                Message                Meaning
-32700              Parse error            Invalid JSON was received by the server.An error occurred on the server while parsing the JSON text.
-32600              Invalid Request        The JSON sent is not a valid Request object.
-32601              Method not found       The method does not exist / is not available.
-32602              Invalid params         Invalid method parameter(s).
-32603              Internal error         Internal JSON-RPC error.
-32000 to -32099    Server error           Reserved for implementation-defined server-errors.
*/


interface WebServiceDefinition {
  service: string;
}

type RequestDebugInfo = {
  debug?: {
    context: {
      id: string;
      metadata: CodeContext["metadata"];
    };
    consoleLog: Serialized<ConsoleLogItem[]>;
  };
};

function getDebugData(): RequestDebugInfo {
  if (debugFlags.etr) {
    return {
      debug: {
        consoleLog: getCodeContext().consoleLog.map(log => ({ ...log, when: log.when.toISOString() })),
        context: {
          id: getCodeContext().id,
          metadata: getCodeContext().metadata,
        }
      }
    };
  }
  return {};
}

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode
 */
function createJSONRPCError(requestid: RequestID, status: HTTPErrorCode, errorCode: number, message: string, trace?: StackTrace) {
  const response: JSONRPCErrorResponse & RequestDebugInfo = {
    id: requestid,
    error: { code: errorCode, message, ...(trace ? { data: { trace } } : null) },
    result: null,
    ...getDebugData()
  };
  return createJSONResponse(status, response);
}

export class JSONRPCError extends Error {
  status: HTTPErrorCode;
  errorCode: number;

  constructor(status: HTTPErrorCode, errorCode: number, message: string) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }

  static readonly MethodNotFound = -32601;
}

async function runJSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponse> {
  let id: RequestID = null;
  try {
    const instance = await makeJSObject(servicedef.service, await newWebRequestFromInfo(req)) as Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
    const jsonrpcreq = JSON.parse(await req.body.text());
    id = jsonrpcreq.id;

    if (!instance[jsonrpcreq.method])
      throw new JSONRPCError(HTTPErrorCode.NotFound, JSONRPCError.MethodNotFound, `Method '${jsonrpcreq.method}' not found`);

    const promise = instance[jsonrpcreq.method](...jsonrpcreq.params);
    const result = await promise;

    const retval = { id, error: null, result, ...getDebugData() };
    return createJSONResponse(HTTPSuccessCode.Ok, retval);
  } catch (e) {
    if (e instanceof JSONRPCError)
      return createJSONRPCError(id, e.status, e.errorCode, e.message);
    else {
      services.logError(e as Error);
      const showerrors = debugFlags.etr || servicedef.service.startsWith("mod::webhare_testsuite/"); //test_jsonrpc2.ts has no way to (temporarily) enable etr
      if (showerrors)
        return createJSONRPCError(id, HTTPErrorCode.InternalServerError, -32000, (e as Error).message, parseTrace(e as Error));
      else
        return createJSONRPCError(id, HTTPErrorCode.InternalServerError, -32000, "Internal error");
    }
  }
}

export async function JSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponseInfo> {
  const context = new CodeContext("jsonrpc", {
    url: req.url.toString(),
  });

  const debugSettings = (await newWebRequestFromInfo(req)).getDebugSettings();
  context.applyDebugSettings(debugSettings);

  const result = await context.run(() => runJSONAPICall(servicedef, req));
  const responseInfo = result.asWebResponseInfo();
  // FIXME: async delayed close of codecontext
  setTimeout(() => void context.close(), 1); //close the context after the response has been sent.
  return responseInfo;
}

class JSONAPICaller extends services.BackendServiceConnection {
  async runJSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponseInfo> {
    const context = new CodeContext("jsonrpc", {
      url: req.url.toString(),
    });

    const debugSettings = (await newWebRequestFromInfo(req)).getDebugSettings();
    context.applyDebugSettings(debugSettings);

    const result = await context.run(() => runJSONAPICall(servicedef, req));
    const responseInfo = result.asWebResponseInfo();
    // FIXME: async delayed close of codecontext
    setTimeout(() => void context.close(), 1); //close the context after the response has been sent
    return responseInfo;
  }
}

export function getJSONApiCaller() {
  return new JSONAPICaller;
}
