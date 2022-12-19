import * as services from "@webhare/services";

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

export async function JSONAPICall(servicedef: WebServiceDefinition, req: WebRequestInfo): Promise<WebResponseInfo> {
  //FIXME reload (only) when code updates
  const theapi = await import(services.toFSPath(servicedef.service.split('#')[0]));
  const objectname = servicedef.service.split('#')[1];
  if (!theapi[objectname])
    throw new Error(`Cannot find '${objectname}' in '${theapi}'`);

  const instance = new theapi[objectname];
  const jsonrpcreq = JSON.parse(req.body);
  if (!instance[jsonrpcreq.method])
    throw new Error(`Cannot find method '${jsonrpcreq.method}' in '${objectname}'`);

  try {
    const result = await instance[jsonrpcreq.method](...jsonrpcreq.params);
    return {
      statusCode: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ id: jsonrpcreq.id, result })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({ id: jsonrpcreq.id, error: (e as Error).message })
    };
  }
}
