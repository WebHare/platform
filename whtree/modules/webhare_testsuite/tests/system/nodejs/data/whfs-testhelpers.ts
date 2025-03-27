import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db } from "@webhare/whdb";
import { describeWHFSType } from "@webhare/whfs";

export async function verifyNumSettings(objid: number, ns: string, expect: number) {
  const type = await describeWHFSType(ns);
  const instances = await db<PlatformDB>()
    .selectFrom("system.fs_instances")
    .selectAll()
    .where("fs_type", "=", type.id)
    .where("fs_object", "=", objid)
    .execute();

  if (instances.length === 2)
    throw new Error(`Found multiple fs_instances for type ${type.id} and object ${objid}`);
  if (expect === 0) {
    if (instances.length)
      throw new Error(`Expected no settings but still found an fs_instance for type ${type.id} and object ${objid}`);
    return;
  }

  if (!instances.length)
    throw new Error(`Expected ${expect} settings but didn't even find fs_instance for type ${type.id} and object ${objid}`);

  const settings = await db<PlatformDB>()
    .selectFrom("system.fs_settings")
    .selectAll()
    .where("fs_instance", "=", instances[0].id)
    .execute();

  if (settings.length !== expect) {
    console.table(settings);
    throw new Error(`Expected ${expect} settings but got ${settings.length} fs_settings for type ${type.id} and object ${objid}`);
  }
}

export async function dumpSettings(objid: number, ns: string) {
  const type = await describeWHFSType(ns);
  const instances = await db<PlatformDB>()
    .selectFrom("system.fs_instances")
    .selectAll()
    .where("fs_type", "=", type.id)
    .where("fs_object", "=", objid)
    .execute();

  if (!instances.length) {
    console.log("No instances found");
    return;
  }
  console.log("fs_instance: ", instances[0]);

  const settings = await db<PlatformDB>()
    .selectFrom("system.fs_settings")
    .selectAll()
    .where("fs_instance", "=", instances[0].id)
    .execute();

  console.log(`${settings.length} settings found`);
  if (settings.length)
    console.table(settings);
}
