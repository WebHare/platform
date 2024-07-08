import { db, Selectable, sql } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { WRDAttributeTypeId, WRDBaseAttributeTypeId, WRDMetaTypeId } from "./types";

const selectSchemaColumns = ["id"] as const;
const selectTypeColumns = ["id", "tag", "metatype", "parenttype", "requiretype_left", "requiretype_right", "abstract", "keephistorydays"] as const;
const selectAttrColumns = ["id", "attributetype", "domain", "isunique", "isunsafetocopy", "parent", "required", "ordered", "tag", "type", "allowedvalues", "checklinks"] as const;
export const selectEntitySettingColumns = ["id", "entity", "attribute", "blobdata", "rawdata", "setting", "ordering", "parentsetting"] as const;
export const selectEntitySettingWHFSLinkColumns = ["id", "fsobject", "linktype"] as const;

export type SchemaRec = Pick<Selectable<PlatformDB, "wrd.schemas">, typeof selectSchemaColumns[number]>;
export type TypeRec = Pick<Selectable<PlatformDB, "wrd.types">, typeof selectTypeColumns[number]> & {
  parentTypeIds: number[];
  childTypeIds: number[];

  parentAttrMap: Map<number | null, AttrRec[]>;
  rootAttrMap: Map<string, AttrRec>;
  attrRootAttrMap: Map<number, AttrRec>;
  consilioLinkCheckAttrs: Set<number>;
  whfsLinkAttrs: Set<number>;
  uniqueAttrs: Set<number>;
  emailAttrs: Set<number>;
};
export type AttrRec = Pick<Selectable<PlatformDB, "wrd.attrs">, typeof selectAttrColumns[number]> & { isreadonly: boolean; attributetype: WRDBaseAttributeTypeId | WRDAttributeTypeId };
export type EntitySettingsRec = Pick<Selectable<PlatformDB, "wrd.entity_settings">, typeof selectEntitySettingColumns[number]>;
export type EntityRec = Selectable<PlatformDB, "wrd.entities">;
export type EntityPartialRec = Partial<EntityRec>;
export type EntitySettingsWHFSLinkRec = Pick<Selectable<PlatformDB, "wrd.entity_settings_whfslink">, typeof selectEntitySettingWHFSLinkColumns[number]>;


export type SchemaData = {
  schema: SchemaRec;
  typeTagMap: Map<string, TypeRec>;
  typeIdMap: Map<number, TypeRec>;
  attrs: AttrRec[];
};

function getBaseAttrsFor(type: TypeRec): AttrRec[] {
  const baseEmptyAttrRec = {
    domain: null,
    isunique: false,
    isunsafetocopy: false,
    isreadonly: false,
    parent: null,
    required: false,
    ordered: false,
    type: type.id,
    allowedvalues: "",
    checklinks: false,
    id: 0,
  };
  const attrs: AttrRec[] = [
    { ...baseEmptyAttrRec, tag: "wrdGuid", attributetype: WRDBaseAttributeTypeId.Base_Guid },
    { ...baseEmptyAttrRec, tag: "wrdId", attributetype: WRDBaseAttributeTypeId.Base_FixedDomain }, // FIXME: make only insertable, not updatable!
    { ...baseEmptyAttrRec, tag: "wrdType", attributetype: WRDBaseAttributeTypeId.Base_FixedDomain, isreadonly: true }, // FIXME: make readonly!
    { ...baseEmptyAttrRec, tag: "wrdTag", attributetype: WRDBaseAttributeTypeId.Base_Tag },
    { ...baseEmptyAttrRec, tag: "wrdCreationDate", attributetype: WRDBaseAttributeTypeId.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, tag: "wrdLimitDate", attributetype: WRDBaseAttributeTypeId.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, tag: "wrdModificationDate", attributetype: WRDBaseAttributeTypeId.Base_ModificationDate },
  ];
  if (type.metatype === WRDMetaTypeId.Domain)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdOrdering", attributetype: WRDBaseAttributeTypeId.Base_Integer });
  if (((type.metatype === WRDMetaTypeId.Attachment || type.metatype === WRDMetaTypeId.Link) && type.requiretype_left) || type.metatype === WRDMetaTypeId.Domain)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdLeftEntity", attributetype: WRDBaseAttributeTypeId.Base_Domain, required: type.metatype !== WRDMetaTypeId.Domain });
  if ((type.metatype === WRDMetaTypeId.Link) && type.requiretype_left)
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdRightEntity", attributetype: WRDBaseAttributeTypeId.Base_Domain, required: true });
  if (type.tag === "wrdPerson") {
    attrs.push(...[
      { ...baseEmptyAttrRec, tag: "wrdRightEntity", attributetype: WRDBaseAttributeTypeId.Base_Integer, required: true },
      { ...baseEmptyAttrRec, tag: "wrdGender", attributetype: WRDBaseAttributeTypeId.Base_Gender },
      { ...baseEmptyAttrRec, tag: "wrdSaluteFormal", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString },
      { ...baseEmptyAttrRec, tag: "wrdAddressFormal", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString, isreadonly: true },
      { ...baseEmptyAttrRec, tag: "wrdFullName", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString, isreadonly: true },
      { ...baseEmptyAttrRec, tag: "wrdTitles", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdInitials", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdFirstName", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdFirstNames", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdInfix", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdLastName", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdTitlesSuffix", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, tag: "wrdDateOfBirth", attributetype: WRDBaseAttributeTypeId.Base_Date },
      { ...baseEmptyAttrRec, tag: "wrdDateOfDeath", attributetype: WRDBaseAttributeTypeId.Base_Date },
    ]);
  }
  if (type.tag === "wrdRelation")
    attrs.push({ ...baseEmptyAttrRec, tag: "wrdTitle", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString });

  return attrs;
}

export async function getSchemaData(tag: string): Promise<SchemaData> {
  let schemaquery = db<PlatformDB>()
    .selectFrom("wrd.schemas")
    .select(selectSchemaColumns);
  schemaquery = schemaquery.where("name", "=", tag);
  const schema = await schemaquery.executeTakeFirst();
  if (!schema)
    throw new Error(`No such schema ${JSON.stringify(tag)}`);
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
      parentAttrMap: new Map<number | null, AttrRec[]>,
      rootAttrMap: new Map<string, AttrRec>,
      attrRootAttrMap: new Map<number, AttrRec>,
      consilioLinkCheckAttrs: new Set<number>,
      whfsLinkAttrs: new Set<number>,
      uniqueAttrs: new Set<number>,
      emailAttrs: new Set<number>,
    }));
  const typeids: number[] = types.map(t => t.id);
  const attrs = (await db<PlatformDB>()
    .selectFrom("wrd.attrs")
    .select(selectAttrColumns)
    .where("type", "=", sql`any(${typeids})`)
    .orderBy("tag")
    .execute()).map(attr => ({
      ...attr,
      isreadonly: false,
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
  const typeAttrMap = Map.groupBy(allAttrs, (attr) => attr.type);

  for (const type of typeIdMap.values()) {
    const typeAttrs = typeAttrMap.get(type.id)!;
    for (const [parent, childAttrs] of Map.groupBy(typeAttrs, attr => attr.parent))
      type.parentAttrMap.set(parent, childAttrs);
    for (const attr of typeAttrs) {
      if (!attr.parent)
        type.rootAttrMap.set(attr.tag, attr);
      if (attr.isunique)
        type.uniqueAttrs.add(attr.id);
      if ([WRDAttributeTypeId.RichDocument, WRDAttributeTypeId.WHFSInstance, WRDAttributeTypeId.URL].includes(attr.attributetype) || attr.checklinks)
        type.consilioLinkCheckAttrs.add(attr.id);
      if (attr.attributetype === WRDAttributeTypeId.WHFSRef)
        type.whfsLinkAttrs.add(attr.id);
      if (attr.attributetype === WRDAttributeTypeId.Email)
        type.emailAttrs.add(attr.id);
    }
    for (const rootAttr of type.rootAttrMap.values())
      recurseStoreRootAttrs(rootAttr, rootAttr.id, type.parentAttrMap, type.attrRootAttrMap);
  }

  return {
    schema,
    typeTagMap,
    typeIdMap,
    attrs,
  };
}

function recurseStoreRootAttrs(rootAttr: AttrRec, current: number, parentAttrMap: Map<number | null, AttrRec[]>, attrRootAttrMap: Map<number, AttrRec>) {
  const attrs = parentAttrMap.get(current);
  if (attrs)
    for (const attr of attrs) {
      attrRootAttrMap.set(attr.id, rootAttr);
      if (parentAttrMap.has(attr.id))
        recurseStoreRootAttrs(rootAttr, attr.id, parentAttrMap, attrRootAttrMap);
    }
}
