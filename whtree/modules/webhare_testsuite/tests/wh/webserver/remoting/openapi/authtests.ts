import { createJSONResponse, HTTPErrorCode, HTTPSuccessCode, RestAuthorizationFunction, RestAuthorizationResult, RestImplementationFunction, RestRequest } from "@webhare/router";

export async function denyAll(req: RestRequest): Promise<RestAuthorizationResult> {
  return { authorized: false };
}

export async function needSecret(req: RestRequest): Promise<RestAuthorizationResult> {
  const key = req.webRequest.headers.get("x-key");
  if (!key)
    return {
      authorized: false,
      response: createJSONResponse(HTTPErrorCode.Unauthorized, {
        error: "Dude where's my key?"
      }, {
        headers: { "WWW-Authenticate": "X-Key" }
      })
    };

  return { authorized: true, loginfo: { lastchar: key.at(-1) || "" }, authorization: { key } };
}

export async function getDummy(req: RestRequest) {
  return createJSONResponse(HTTPSuccessCode.Ok, (req.authorization as any).key);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_denyAll: RestAuthorizationFunction = denyAll;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_getDummy: RestImplementationFunction = getDummy;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature
const validate_needSecret: RestAuthorizationFunction = needSecret;
