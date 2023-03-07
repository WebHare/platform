import { db, Selectable } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";

const selectSchemaColumns = ["id"] as const;
const selectTypeColumns = ["id", "tag", "metatype", "parenttype", "requiretype_left", "requiretype_right", "abstract"] as const;
const selectAttrColumns = ["id", "attributetype", "domain", "isunique", "isunsafetocopy", "parent", "required", "ordered", "tag", "type", "allowedvalues"] as const;
export const selectEntitySettingColumns = ["entity", "attribute", "blobdata", "rawdata", "setting", "ordering", "parentsetting"] as const;


export type SchemaRec = Pick<Selectable<WebHareDB, "wrd.schemas">, typeof selectSchemaColumns[number]>;
export type TypeRec = Pick<Selectable<WebHareDB, "wrd.types">, typeof selectTypeColumns[number]>;
export type AttrRec = Pick<Selectable<WebHareDB, "wrd.attrs">, typeof selectAttrColumns[number]>;
export type EntitySettingsRec = Pick<Selectable<WebHareDB, "wrd.entity_settings">, typeof selectEntitySettingColumns[number]>;
export type EntityPartialRec = Partial<Selectable<WebHareDB, "wrd.entities">>;


export type SchemaData = {
  schema: SchemaRec;
  typeidmap: Map<number, TypeRec>;
  typetagmap: Map<string, TypeRec>;
  attrs: AttrRec[];
};

export async function getSchemaData(id: string | number): Promise<SchemaData | undefined> {
  let schemaquery = db<WebHareDB>()
    .selectFrom("wrd.schemas")
    .select(selectSchemaColumns);
  if (typeof id === "number")
    schemaquery = schemaquery.where("id", "=", id);
  else
    schemaquery = schemaquery.where("name", "=", id);
  const schema = await schemaquery.executeTakeFirst();
  if (!schema)
    return;
  const types = await db<WebHareDB>()
    .selectFrom("wrd.types")
    .select(selectTypeColumns)
    .where("wrd_schema", "=", schema.id)
    .orderBy("id")
    .execute();
  const typeids: number[] = types.map(t => t.id);
  const attrs = await db<WebHareDB>()
    .selectFrom("wrd.attrs")
    .select(selectAttrColumns)
    .where("type", "in", typeids)
    .orderBy("type")
    .orderBy("tag")
    .execute();
  const typetagmap = new Map(types.map(type => [type.tag, type]));
  const typeidmap = new Map(types.map(type => [type.id, type]));
  return { schema, typeidmap, typetagmap, attrs };
}
