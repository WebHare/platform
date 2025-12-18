import { toSnakeCase } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { createFirstPartyToken, deleteToken, getToken, listTokens, updateToken } from "@webhare/auth";
import { WRDSchema } from "@webhare/wrd";
import { defaultDateTime } from "@webhare/hscompat";


export async function getAPIKeys(wrdschema: string, entity: number) {
  return toSnakeCase(await listTokens(new WRDSchema(wrdschema), entity));
}

export async function createAPIkey(wrdschema: string, entity: number, expires: Date, title: string, scopes: string[]): Promise<{
  access_token: string;
  expires: Temporal.Instant | null;
  id: number;
}> {
  const tok = await createFirstPartyToken(new WRDSchema(wrdschema), "api", entity, {
    title: title,
    expires: expires.getTime() === defaultDateTime.getTime() ? Infinity : expires,
    scopes: scopes
  });
  return toSnakeCase(tok);
}

export async function deleteAPIKey(wrdschema: string, keyId: number) {
  return await runInWork(() => deleteToken(new WRDSchema(wrdschema), keyId));
}

export async function getAPIKey(wrdschema: string, keyId: number) {
  return toSnakeCase(await getToken(new WRDSchema(wrdschema), keyId));
}

export async function updateAPIKey(wrdschema: string, keyId: number, expires: Date, title: string, scopes: string[]) {
  return await runInWork(() => updateToken(new WRDSchema(wrdschema), keyId, {
    expires: expires.getTime() === defaultDateTime.getTime() ? null : expires.toTemporalInstant(),
    title,
    scopes
  }));
}
