import { db, Selectable, sql } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { WRDBaseAttributeType, WRDMetaType } from "./types";

const selectSchemaColumns = ["id"] as const;
const selectTypeColumns = ["id", "tag", "metatype", "parenttype", "requiretype_left", "requiretype_right", "abstract"] as const;
const selectAttrColumns = ["id", "attributetype", "domain", "isunique", "isunsafetocopy", "parent", "required", "ordered", "tag", "type", "allowedvalues"] as const;
export const selectEntitySettingColumns = ["id", "entity", "attribute", "blobdata", "rawdata", "setting", "ordering", "parentsetting"] as const;
export const selectEntitySettingWHFSLinkColumns = ["id", "fsobject", "linktype"] as const;

export type SchemaRec = Pick<Selectable<PlatformDB, "wrd.schemas">, typeof selectSchemaColumns[number]>;
export type TypeRec = Pick<Selectable<PlatformDB, "wrd.types">, typeof selectTypeColumns[number]> & { parentTypeIds: number[]; childTypeIds: number[] };
export type AttrRec = Pick<Selectable<PlatformDB, "wrd.attrs">, typeof selectAttrColumns[number]>;
export type EntitySettingsRec = Pick<Selectable<PlatformDB, "wrd.entity_settings">, typeof selectEntitySettingColumns[number]>;
export type EntityPartialRec = Partial<Selectable<PlatformDB, "wrd.entities">>;
export type EntitySettingsWHFSLinkRec = Pick<Selectable<PlatformDB, "wrd.entity_settings_whfslink">, typeof selectEntitySettingWHFSLinkColumns[number]>;


export type SchemaData = {
  schema: SchemaRec;
  typeTagMap: Map<string, TypeRec>;
  typeIdMap: Map<number, TypeRec>;
  attrs: AttrRec[];
  typeParentAttrMap: Map<number, Map<number | null, AttrRec[]>>;
  typeRootAttrMap: Map<number, Map<string, AttrRec>>;
};

function mappedGroupBy<Incoming, Key, Value, Result = Value[]>(
  data: Iterable<Incoming>,
  processElt: (elt: Incoming, idx: number) => [Key, Value],
  processResult?: (values: Value[]) => Result,
): Map<Key, Result> {
  const retval = new Map<Key, Value[]>;
  for (const elt of Array.from(data).entries()) {
    const r = processElt(elt[1], elt[0]);
    const arr = retval.get(r[0]);
    if (!arr)
      retval.set(r[0], [r[1]]);
    else
      arr.push(r[1]);
  }
  if (processResult) {
    const ret2 = new Map<Key, Result>;
    for (const [k, v] of retval.entries())
      ret2.set(k, processResult(v));
    return ret2;
  } else
    return retval as Map<Key, Result>;
}

function getBaseAttrsFor(type: TypeRec): AttrRec[] {
  const baseEmptyAttrRec = {
    domain: null,
    isunique: false,
    isunsafetocopy: false,
    parent: null,
    required: false,
    ordered: false,
    type: type.id,
    allowedvalues: "",
    id: 0,
  };
  const attrs: AttrRec[] = [
    { ...baseEmptyAttrRec, tag: "wrdGuid", attributetype: WRDBaseAttributeType.Base_Guid },
    { ...baseEmptyAttrRec, tag: "wrdId", attributetype: WRDBaseAttributeType.Base_Integer }, // FIXME: make only insertable, not updatable!
    { ...baseEmptyAttrRec, tag: "wrdType", attributetype: WRDBaseAttributeType.Base_Integer }, // FIXME: make readonly!
    { ...baseEmptyAttrRec, tag: "wrdTag", attributetype: WRDBaseAttributeType.Base_Tag },
    { ...baseEmptyAttrRec, tag: "wrdCreationDate", attributetype: WRDBaseAttributeType.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, tag: "wrdLimitDate", attributetype: WRDBaseAttributeType.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, tag: "wrdModificationDate", attributetype: WRDBaseAttributeType.Base_ModificationDate },
  ];
  if (type.metatype === WRDMetaType.Domain)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdOrdering", attributetype: WRDBaseAttributeType.Base_Integer });
  if (((type.metatype === WRDMetaType.Attachment || type.metatype === WRDMetaType.Link) && type.requiretype_left) || type.metatype === WRDMetaType.Domain)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdLeftEntity", attributetype: WRDBaseAttributeType.Base_Domain, required: type.metatype !== WRDMetaType.Domain });
  if ((type.metatype === WRDMetaType.Link) && type.requiretype_left)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdRightEntity", attributetype: WRDBaseAttributeType.Base_Domain, required: true });
  if (type.tag === "wrdPerson") {
    attrs.push(...[
      { ...baseEmptyAttrRec, tag: "wrdRightEntity", attributetype: WRDBaseAttributeType.Base_Integer, required: true },
      { ...baseEmptyAttrRec, tag: "wrdGender", attributetype: WRDBaseAttributeType.Base_Gender },
      { ...baseEmptyAttrRec, tag: "wrdSaluteFormal", attributetype: WRDBaseAttributeType.Base_GeneratedString },
      { ...baseEmptyAttrRec, tag: "wrdAddressFormal", attributetype: WRDBaseAttributeType.Base_GeneratedString },
      { ...baseEmptyAttrRec, tag: "wrdFullName", attributetype: WRDBaseAttributeType.Base_GeneratedString },
      { ...baseEmptyAttrRec, tag: "wrdTitles", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdInitials", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdFirstName", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdFirstNames", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdInfix", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdLastName", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdTitlesSuffix", attributetype: WRDBaseAttributeType.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdDateOfBirth", attributetype: WRDBaseAttributeType.Base_Date },
      { ...baseEmptyAttrRec, tag: "wrdDateOfDeath", attributetype: WRDBaseAttributeType.Base_Date },
    ]);
  }
  if (type.tag === "wrdRelation")
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdTitle", attributetype: WRDBaseAttributeType.Base_GeneratedString });

  return attrs;
}

export async function getSchemaData(id: string | number): Promise<SchemaData> {
  let schemaquery = db<PlatformDB>()
    .selectFrom("wrd.schemas")
    .select(selectSchemaColumns);
  if (typeof id === "number")
    schemaquery = schemaquery.where("id", "=", id);
  else
    schemaquery = schemaquery.where("name", "=", id);
  const schema = await schemaquery.executeTakeFirst();
  if (!schema)
    throw new Error(`No such schema ${JSON.stringify(id)}`);
  const types = (await db<PlatformDB>()
    .selectFrom("wrd.types")
    .select(selectTypeColumns)
    .where("wrd_schema", "=", schema.id)
    .orderBy("id")
    .execute()).map(type => ({
      ...type,
      tag: tagToJS(type.tag),
      parentTypeIds: [type.id],
      childTypeIds: [type.id],
    }));
  const typeids: number[] = types.map(t => t.id);
  const attrs = (await db<PlatformDB>()
    .selectFrom("wrd.attrs")
    .select(selectAttrColumns)
    .where("type", "=", sql`any(${typeids})`)
    .orderBy("tag")
    .execute()).map(attr => ({
      ...attr,
      tag: tagToJS(attr.tag),
    }));
  const typeTagMap = new Map(types.map(type => [type.tag, type]));
  const typeIdMap = new Map(types.map(type => [type.id, type]));
  for (const typerec of types) {
    let parentType = typerec.parenttype;
    const parentTypeTags = new Set<string>;
    parentTypeTags.add(typerec.tag);
    while (parentType) {
      parentTypeTags.add(typerec.tag);
      const parentTypeRec = typeIdMap.get(parentType);
      if (!parentTypeRec)
        break;
      typerec.parentTypeIds.push(parentTypeRec.id);
      parentTypeRec.childTypeIds.push(typerec.id);
      parentType = parentTypeRec.parenttype;
    }
    attrs.push(...getBaseAttrsFor(typerec));
  }
  const allAttrs: typeof attrs = [];
  for (const attr of attrs) {
    const inTypes = typeIdMap.get(attr.type)!.childTypeIds;
    if (attr.tag === "wrdTitle") {
      const wrdOrganizationId = typeTagMap.get("wrdOrganization")?.id;
      const wrdOrgNameAttr = allAttrs.find(a => a.type === wrdOrganizationId && a.tag === "wrdOrgName");
      for (const type of inTypes) {
        // redirect wrd_title to wrd_orgname in wrd_organization and child types by setting overriding id and attributetype
        if (wrdOrganizationId && wrdOrgNameAttr && typeIdMap.get(type)?.parentTypeIds.includes(wrdOrganizationId)) {
          allAttrs.push({ ...attr, id: wrdOrgNameAttr.id, attributetype: wrdOrgNameAttr.attributetype, type });
        } else
          allAttrs.push({ ...attr, type });
      }
    } else {
      for (const type of inTypes) {
        allAttrs.push({ ...attr, type });
      }
    }
  }
  const typeParentAttrMap = mappedGroupBy(allAttrs, (attr) => [attr.type, attr], (attrlist) => mappedGroupBy(attrlist, (attr) => [attr.parent, attr]));
  const typeRootAttrMap = mappedGroupBy(allAttrs.filter(attr => !attr.parent), (attr) => [attr.type, attr], (attrlist) => new Map(Array.from(attrlist.values()).map(attr => [attr.tag, attr])));
  const retval = {
    schema,
    typeTagMap,
    typeIdMap,
    attrs,
    typeParentAttrMap,
    typeRootAttrMap
  };
  //console.log(retval);

  return retval;
}
