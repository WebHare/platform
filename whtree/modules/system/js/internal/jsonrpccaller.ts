import { HTTPErrorCode, createJSONResponse, WebResponse, HTTPSuccessCode, WebRequest } from "@webhare/router";
import * as services from "@webhare/services";
import { WebRequestInfo, WebResponseInfo } from "./types";
import { StackTrace, parseTrace, } from "@webhare/js-api-tools";
import { debugFlags } from "@webhare/env/src/envbackend";
import { RequestID, type JSONRPCErrorResponse } from "@webhare/jsonrpc-client/src/jsonrpc-client";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
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

let currentrequest: WebRequest | undefined;

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode
 */
function createJSONRPCError(requestid: RequestID, status: HTTPErrorCode, errorCode: number, message: string, trace?: StackTrace) {
  const response: JSONRPCErrorResponse = { id: requestid, error: { code: errorCode, message, ...(trace ? { data: { trace } } : null) }, result: null };
  return createJSONResponse(status, response);
}

export class JSONRPCError {
  status: HTTPErrorCode;
  errorCode: number;
  message: string;

  constructor(status: HTTPErrorCode, errorCode: number, message: string) {
    this.status = status;
    this.errorCode = errorCode;
    this.message = message;
  }

  static readonly MethodNotFound = -32601;
}

/** Get the request info for the current API call. NOTE we're looking for a cleaner way to invoke JSONRPCs with this context */
export function getJSONAPICallWebRequest(): WebRequest {
  if (currentrequest)
    return currentrequest;
  throw new Error(`getJSONAPICallWebRequest must be invoked directly upon entry of a JSON/RPC call handler`); //and this is why we need a cleaner approach or just pass it as an arugment
}

async function runJSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponse> {
  let id: RequestID = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- TODO - our require plugin doesn't support await import yet
    const theapi = require(services.toFSPath(servicedef.service.split('#')[0]));
    const objectname = servicedef.service.split('#')[1];
    if (!theapi[objectname])
      throw new Error(`Cannot find '${objectname}' in '${theapi}'`);

    const instance = new theapi[objectname];
    const jsonrpcreq = JSON.parse(await req.body.text());
    id = jsonrpcreq.id;

    if (!instance[jsonrpcreq.method])
      throw new JSONRPCError(HTTPErrorCode.NotFound, JSONRPCError.MethodNotFound, `Method '${jsonrpcreq.method}' not found`);

    currentrequest = await newWebRequestFromInfo(req); //will be available until the first 'tick'
    const promise = instance[jsonrpcreq.method](...jsonrpcreq.params);
    currentrequest = undefined;
    const result = await promise;

    return createJSONResponse(HTTPSuccessCode.Ok, { id, error: null, result });
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
  const result = await runJSONAPICall(servicedef, req);
  return result.asWebResponseInfo();
}

class JSONAPICaller {
  async runJSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponseInfo> {
    const retval = await runJSONAPICall(servicedef, req);
    return retval.asWebResponseInfo();
  }
}

export function getJSONApiCaller() {
  return new JSONAPICaller;
}
