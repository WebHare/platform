import type { MapRecordOutputMap, OutputMap, RecordizeOutputMap, SchemaTypeDefinition, WRDUpdatable } from "./types";
import type { WRDSchema } from "./wrd";

export const wrdSettingsGuid = "07004000-0000-4000-a000-00bea61ef00d";

export async function getSchemaSettings<SchemaType extends SchemaTypeDefinition, M extends string[] & OutputMap<SchemaType["wrdSettings"]>>(schema: WRDSchema<SchemaType>, fields: M)
  : Promise<MapRecordOutputMap<SchemaType["wrdSettings"], RecordizeOutputMap<SchemaType["wrdSettings"], M>>> {

  //@ts-ignore FIXME "=" is not recognized as valid by TS
  const retval = await schema.query("wrdSettings").where("wrdGuid", "=", wrdSettingsGuid).select(fields).execute();
  if (!retval[0])
    throw new Error(`No WRD settings found for schema ${schema.tag}`);

  //@ts-ignore FIXME either TS and/or I is confused
  return retval[0];
}

export async function updateSchemaSettings<SchemaType extends SchemaTypeDefinition>(schema: WRDSchema<SchemaType>, value: WRDUpdatable<SchemaType["wrdSettings"]>) {
  //@ts-ignore FIXME the guid is not recognized as valid by TS
  const id = await schema.search("wrdSettings", "wrdGuid", wrdSettingsGuid);
  if (!id)
    throw new Error(`No WRD settings found for schema ${schema.tag}`);

  await schema.update("wrdSettings", id, value);
}
