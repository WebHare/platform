import * as services from "@webhare/services";

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

interface WebRequestInfo {
  url: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

interface WebResponseInfo {
  statusCode: number;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

class JSONRPCError extends Error {
  statusCode: number;
  errorCode: number;

  constructor(statusCode: number, errorCode: number, message: string) {
    super();
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.message = message;
  }

  static readonly MethodNotFound = -32601;
}

export async function JSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponseInfo> {
  let id: number | null = null;
  //FIXME reload (only) when code updates
  await services.ready();

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- TODO - our require plugin doesn't support await import yet
    const theapi = require(services.toFSPath(servicedef.service.split('#')[0]));
    const objectname = servicedef.service.split('#')[1];
    if (!theapi[objectname])
      throw new Error(`Cannot find '${objectname}' in '${theapi}'`);

    const instance = new theapi[objectname];
    const jsonrpcreq = JSON.parse(req.body);
    id = jsonrpcreq.id;

    if (!instance[jsonrpcreq.method])
      throw new JSONRPCError(404, JSONRPCError.MethodNotFound, `Method '${jsonrpcreq.method}' not found`);

    const result = await instance[jsonrpcreq.method](...jsonrpcreq.params);
    return {
      statusCode: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ id: jsonrpcreq.id, result, error: null })
    };
  } catch (e) {
    const error =
    {
      code: e instanceof JSONRPCError ? e.errorCode : -32000,
      message: e instanceof Error ? e.message : String(e)
    };

    return {
      statusCode: e instanceof JSONRPCError ? e.statusCode : 500,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ id, error, result: null })
    };
  }
}
