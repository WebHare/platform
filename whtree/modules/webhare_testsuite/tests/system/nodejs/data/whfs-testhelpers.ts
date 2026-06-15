import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { buildInstance, buildRTD, WebHareBlob } from "@webhare/services";
import { ComposedDocument } from "@webhare/services/src/composeddocument";
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

export async function generateForm(content: {
  text: string;
}): Promise<ComposedDocument> {
  const formContent = new ComposedDocument("platform:formdefinition", WebHareBlob.from(`
      <formdefinitions xmlns="http://www.webhare.net/xmlns/publisher/forms">
        <form name="webtoolform">
          <page>
            <richtext textid="Yl98JQ8ztbgW3-KdqLzYBA" title="P1" guid="formcomp:9A757BDEF63422BC86F6C5586FDA3508"/>
          </page>
        </form>
      </formdefinitions>`), {
    instances: {
      'Yl98JQ8ztbgW3-KdqLzYBA': await buildInstance({
        whfsType: 'platform:filetypes.richdocument',
        data: {
          data: await buildRTD([{ p: content.text }])
        }
      })
    }
  });
  return formContent;
}
