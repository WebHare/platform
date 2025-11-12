import { createPublicKey, type JsonWebKey } from "node:crypto";
import jwt, { type VerifyOptions } from "jsonwebtoken";

export async function verifyJWT(keys: string, token: string, clockTimestamp: Date, verifyoptions?: VerifyOptions) {
  verifyoptions = { clockTolerance: 5, ...verifyoptions, clockTimestamp: clockTimestamp.getTime() / 1000 };
  const decoded = jwt.decode(token, { complete: true });
  const key = (JSON.parse(keys).keys as Array<JsonWebKey & { kid: string }>).find(k => k.kid === decoded?.header.kid);
  if (!key)
    return null;

  const jwk = createPublicKey({ key: key, format: 'jwk' });
  const data = jwt.verify(token, jwk, verifyoptions);

  if (typeof data !== "object")
    return null;

  return data;
}
