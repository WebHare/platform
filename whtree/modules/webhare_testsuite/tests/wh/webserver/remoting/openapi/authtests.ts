import { createJSONResponse, HTTPErrorCode, RestAuthorizationFunction, RestAuthorizationResult, RestImplementationFunction, RestRequest } from "@webhare/router";

export async function denyAll(req: RestRequest) {
  return { authorized: false };
}

export async function needSecret(req: RestRequest): Promise<RestAuthorizationResult> {
  if (!req.webrequest.headers.get("x-key"))
    return {
      authorized: false,
      response: createJSONResponse({
        error: "Dude where's my key?"
      }, {
        status: HTTPErrorCode.Unauthorized,
        headers: { "WWW-Authenticate": "X-Key" }
      })
    };

  return { authorized: true, authorization: { key: req.webrequest.headers.get("x-key") } };
}

export async function getDummy(req: RestRequest) {
  return createJSONResponse((req.authorization as any).key);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_denyAll: RestAuthorizationFunction = denyAll;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_getDummy: RestImplementationFunction = getDummy;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_needSecret: RestAuthorizationFunction = needSecret;
