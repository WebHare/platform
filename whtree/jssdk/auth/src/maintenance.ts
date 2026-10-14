import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { wrd, type WRDSchemaLike, type WRDSchemaType } from "@webhare/wrd";
import { runInWork } from "@webhare/whdb";

export async function cleanupDynamicClients<S extends SchemaTypeDefinition>(authSchema: WRDSchemaType<S>, now = Temporal.Now.instant()) {
  const idpSchema = wrd<WRDSchemaLike["wrd:idp"]>(authSchema.tag);
  await runInWork(async () => {
    for (const status of ["created", "active"] as const) {
      /* 'created' clients never completed a token exchange, so they're abandoned registrations.
         'active' clients expire 14 days after registration even if they're still in use, as we don't track when a client was last used:
         a last-use field on wrdauthApplication would add a WRD history entry on every token exchange. Clients that need to keep
         working (eg. WebHare peers) are expected to re-register (registerAtRemoteWebHare does so automatically when the remote rejects
         its registration, but the user will need to authorize the new client again). Revisit this if we find a way to track last use
         without bloating the history. */
      const cutoff = now.subtract({ hours: status === "created" ? 6 : 14 * 24 });
      const clientIds = await idpSchema.query("wrdauthApplication")
        .where("dynamicStatus", "=", status)
        .where("wrdCreated", "<", cutoff)
        .select("wrdId")
        .execute();
      if (clientIds.length)
        await idpSchema.delete("wrdauthApplication", clientIds);
    }
  });
}
