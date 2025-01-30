import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { decodeHSONorJSONRecord } from "@webhare/hscompat";
import { db } from "@webhare/whdb";

export async function getAuditLog(entity: number) {
  const events = await db<PlatformDB>().selectFrom("wrd.auditevents").selectAll().where("entity", "=", entity).execute();
  return events.map(evt => {
    return {
      creationDate: evt.creationdate,
      data: decodeHSONorJSONRecord(evt.data),
      // entity: evt.entity,
      impersonated: evt.impersonated,
      ip: evt.ip,
      login: evt.login,
      type: evt.type,
      //igonring wrdschema, you oughta know.. and never select cross-schema anyawy
      browserTriplet: evt.browsertriplet,
      country: evt.country,
      impersonatorEntity: evt.impersonator_entity,
      impersonatorLogin: evt.impersonator_login,
      byEntity: evt.byentity,
      byLogin: evt.bylogin
    };
  });
}
