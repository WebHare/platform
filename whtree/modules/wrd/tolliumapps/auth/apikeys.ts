import { toSnakeCase } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { createFirstPartyToken, deleteToken, listTokens } from "@webhare/auth";
import { WRDSchema } from "@webhare/wrd";


export async function getAPIKeys(wrdschema: string, entity: number) {
  return toSnakeCase(await listTokens(new WRDSchema(wrdschema), entity));
}

export async function createAPIkey(wrdschema: string, entity: number): Promise<{
  access_token: string;
  expires: Temporal.Instant | null;
  id: number;
}> {
  const tok = await createFirstPartyToken(new WRDSchema(wrdschema), "api", entity);
  return toSnakeCase(tok);
}

export async function deleteAPIKey(wrdschema: string, keyId: number) {
  return await runInWork(() => deleteToken(new WRDSchema(wrdschema), keyId));
}
