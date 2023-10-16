import { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { decodeHSONorJSONRecord } from "@webhare/hscompat";
import { db } from "@webhare/whdb";

export async function getAuditLog(entity: number) {
  const events = await db<PlatformDB>().selectFrom("wrd.auditevents").selectAll().where("entity", "=", entity).execute();
  return events.map(evt => ({
    ...evt,
    //Prepare for JSON in auditlog records ... but TODO we don't generate these yet!
    data: decodeHSONorJSONRecord(evt.data)
  }));
}
