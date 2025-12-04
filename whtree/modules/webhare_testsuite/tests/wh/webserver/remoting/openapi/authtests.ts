import { HTTPErrorCode, HTTPSuccessCode, type OpenAPIAuthorization, type OpenAPIAuthorizationFunction, type OpenAPIDefaultErrorMapperFunction, type OpenAPIImplementationFunction, type OpenAPIRequest } from "@webhare/openapi-service";
import { createJSONResponse } from "@webhare/router";

export async function denyAll(req: OpenAPIRequest): Promise<OpenAPIAuthorization> {
  return { authorized: false };
}

export async function needSecret(req: OpenAPIRequest): Promise<OpenAPIAuthorization> {
  const key = req.webRequest.headers.get("authorization");
  if (!key)
    return {
      authorized: false,
      response: req.createErrorResponse(HTTPErrorCode.Unauthorized, {
        message: "Dude where's my key?"
      }, {
        headers: { "WWW-Authenticate": "Authorization" }
      })
    };

  return { authorized: true, loginfo: { lastchar: key.at(-1) || "" }, authorization: { key } };
}

export async function getDummy(req: OpenAPIRequest) {
  return req.createJSONResponse(HTTPSuccessCode.Ok, (req.authorization as any).key);
}

export async function mapDefaultError({ status, error }: { status: HTTPErrorCode; error: string }) {
  return createJSONResponse(status, { message: error });
}

//validate signatures
denyAll satisfies OpenAPIAuthorizationFunction;
getDummy satisfies OpenAPIImplementationFunction;
needSecret satisfies OpenAPIAuthorizationFunction;
mapDefaultError satisfies OpenAPIDefaultErrorMapperFunction;
