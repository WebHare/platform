import { HTTPErrorCode, createJSONResponse, WebResponse, HTTPSuccessCode } from "@webhare/router";
import * as services from "@webhare/services";
import { WebRequestInfo, WebResponseInfo } from "./types";

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

/** An identifier established by the Client that MUST contain a String, Number, or NULL value if included. If it is not included it is assumed to be a notification. The value SHOULD normally not be Null and Numbers SHOULD NOT contain fractional parts  */
type RequestID = number | string | null;

/** Create a webresponse returning a JSON body
 * @param jsonbody - The JSON body to return
 * @param options - Optional statuscode
 */
export function createJSONRPCError(requestid: RequestID, status: HTTPErrorCode, errorCode: number, message: string) {
  return createJSONResponse(status, { id: requestid, error: { code: errorCode, message }, result: null });
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

    const result = await instance[jsonrpcreq.method](...jsonrpcreq.params);
    return createJSONResponse(HTTPSuccessCode.Ok, { id, error: null, result });
  } catch (e) {
    if (e instanceof JSONRPCError)
      return createJSONRPCError(id, e.status, e.errorCode, e.message);
    else {
      services.logError(e as Error);
      //FIXME provide error info and stacktrace if `etr` debugflag is set and verified
      return createJSONRPCError(id, HTTPErrorCode.InternalServerError, -32000, "Internal error"); //Do not leak Error object information
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
