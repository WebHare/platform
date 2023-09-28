import { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { db } from "@webhare/whdb";
import { describeContentType } from "@webhare/whfs";

export async function verifyNumSettings(objid: number, ns: string, expect: number) {
  const type = await describeContentType(ns);
  const instances = await db<WebHareDB>()
    .selectFrom("system.fs_instances")
    .selectAll()
    .where("fs_type", "=", type.id)
    .where("fs_object", "=", objid)
    .execute();

  if (instances.length == 2)
    throw new Error(`Found multiple fs_instances for type ${type.id} and object ${objid}`);
  if (expect == 0) {
    if (instances.length)
      throw new Error(`Expected no settings but still found an fs_instance for type ${type.id} and object ${objid}`);
    return;
  }

  if (!instances.length)
    throw new Error(`Expected ${expect} settings but didn't even find fs_instance for type ${type.id} and object ${objid}`);

  const settings = await db<WebHareDB>()
    .selectFrom("system.fs_settings")
    .selectAll()
    .where("fs_instance", "=", instances[0].id)
    .execute();

  if (settings.length !== expect) {
    console.table(settings);
    throw new Error(`Expected ${expect} settings but got ${settings.length} fs_settinsg for type ${type.id} and object ${objid}`);
  }
}
