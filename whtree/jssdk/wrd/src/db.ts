import { db, type Selectable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { tagToHS, tagToJS } from "./wrdsupport";
import { WRDAttributeTypeId, WRDBaseAttributeTypeId } from "./types";

const selectSchemaColumns = ["id"] as const;
const selectTypeColumns = ["id", "tag", "metatype", "parenttype", "requiretype_left", "requiretype_right", "abstract", "keephistorydays"] as const;
const selectAttrColumns = ["id", "attributetype", "domain", "isunique", "isunsafetocopy", "parent", "required", "ordered", "tag", "type", "allowedvalues", "checklinks"] as const;
const wrdMetaTypeId = {
  Object: 1,
  Link: 2,
  Attachment: 3,
  Domain: 4,
} as const;


export const selectEntitySettingColumns = ["id", "entity", "attribute", "blobdata", "rawdata", "setting", "ordering", "parentsetting"] as const;
export const selectEntitySettingWHFSLinkColumns = ["id", "fsobject", "linktype"] as const;

export type SchemaRec = Pick<Selectable<PlatformDB, "wrd.schemas">, typeof selectSchemaColumns[number]>;
export type TypeRec = Pick<Selectable<PlatformDB, "wrd.types">, typeof selectTypeColumns[number]> & {
  parentTypeIds: number[];
  childTypeIds: number[];

  /// All attributes for this type, grouped by parent attribute id (null for root attributes)
  parentAttrMap: Map<number | null, AttrRec[]>;
  /// All root attributes for this type, indexed by tag. FIXME: use attrByFullTagMap and check if parent is null
  rootAttrMap: Map<string, AttrRec>;
  /// All attributes for this type, indexed by full tag.
  attrByFullTagMap: Map<string, AttrRec>;
  /// Maps attribute id to HS attribute name
  attrHSNameMap: Map<number, string>;
  /// Root attribute for all attributes of this type
  attrRootAttrMap: Map<number, AttrRec>;
  /// All attributes that are used for consilio link checks
  consilioLinkCheckAttrs: Set<number>;
  /// All attributes that are used for WHFS links
  whfsLinkAttrs: Set<number>;
  /// All attributes that are unique
  uniqueAttrs: Set<number>;
  /// All attributes that are used for email addresses
  emailAttrs: Set<number>;
  /// The schema id this type belongs to
  schemaId: number;
};
export type AttrRec = Pick<Selectable<PlatformDB, "wrd.attrs">, typeof selectAttrColumns[number]> & { isreadonly: boolean; attributetype: WRDBaseAttributeTypeId | WRDAttributeTypeId; hsTag: string; fullTag: string; schemaId: number };
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
    schemaId: type.schemaId,
    allowedvalues: "",
    checklinks: false,
    id: 0,
  };
  const attrs: AttrRec[] = [
    { ...baseEmptyAttrRec, hsTag: "WRD_GUID", tag: "wrdGuid", fullTag: "wrdGuid", attributetype: WRDBaseAttributeTypeId.Base_Guid, isunique: true },
    { ...baseEmptyAttrRec, hsTag: "WRD_ID", tag: "wrdId", fullTag: "wrdId", attributetype: WRDBaseAttributeTypeId.Base_Id, isunique: true }, // FIXME: make only insertable, not updatable!
    { ...baseEmptyAttrRec, hsTag: "WRD_TYPE", tag: "wrdType", fullTag: "wrdType", attributetype: WRDBaseAttributeTypeId.Base_Type, isreadonly: true }, // FIXME: make readonly!
    { ...baseEmptyAttrRec, hsTag: "WRD_TAG", tag: "wrdTag", fullTag: "wrdTag", attributetype: WRDBaseAttributeTypeId.Base_Tag, isunique: true },
    { ...baseEmptyAttrRec, hsTag: "WRD_CREATIONDATE", tag: "wrdCreationDate", fullTag: "wrdCreationDate", attributetype: WRDBaseAttributeTypeId.Base_Legacy_CreationLimitDate },
    { ...baseEmptyAttrRec, hsTag: "WRD_LIMITDATE", tag: "wrdLimitDate", fullTag: "wrdLimitDate", attributetype: WRDBaseAttributeTypeId.Base_Legacy_CreationLimitDate },
    { ...baseEmptyAttrRec, hsTag: "WRD_MODIFICATIONDATE", tag: "wrdModificationDate", fullTag: "wrdModificationDate", attributetype: WRDBaseAttributeTypeId.Base_Legacy_ModificationDate },
    { ...baseEmptyAttrRec, hsTag: "WRD_CREATIONDATE", tag: "wrdCreated", fullTag: "wrdCreated", attributetype: WRDBaseAttributeTypeId.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, hsTag: "WRD_LIMITDATE", tag: "wrdClosed", fullTag: "wrdClosed", attributetype: WRDBaseAttributeTypeId.Base_CreationLimitDate },
    { ...baseEmptyAttrRec, hsTag: "WRD_MODIFICATIONDATE", tag: "wrdModified", fullTag: "wrdModified", attributetype: WRDBaseAttributeTypeId.Base_ModificationDate },
  ];
  if (type.metatype === wrdMetaTypeId.Domain) {
    attrs.push({ ...baseEmptyAttrRec, hsTag: "WRD_ORDERING", tag: "wrdOrdering", fullTag: "wrdOrdering", attributetype: WRDBaseAttributeTypeId.Base_Integer });
    attrs.push({ ...baseEmptyAttrRec, hsTag: "WRD_ORDERING", tag: "wrdOrder", fullTag: "wrdOrder", attributetype: WRDBaseAttributeTypeId.Base_Integer });
  }
  if (((type.metatype === wrdMetaTypeId.Attachment || type.metatype === wrdMetaTypeId.Link) && type.requiretype_left) || type.metatype === wrdMetaTypeId.Domain)
    attrs.push({ ...baseEmptyAttrRec, hsTag: "WRD_LEFTENTITY", tag: "wrdLeftEntity", fullTag: "wrdLeftEntity", attributetype: WRDBaseAttributeTypeId.Base_Domain, required: type.metatype !== wrdMetaTypeId.Domain, domain: type.metatype === wrdMetaTypeId.Domain ? type.id : type.requiretype_left });
  if ((type.metatype === wrdMetaTypeId.Link) && type.requiretype_right)
    attrs.push({ ...baseEmptyAttrRec, hsTag: "WRD_RIGHTENTITY", tag: "wrdRightEntity", fullTag: "wrdRightEntity", attributetype: WRDBaseAttributeTypeId.Base_Domain, required: true, domain: type.requiretype_right });
  if (type.tag === "wrdPerson") {
    attrs.push(...[
      { ...baseEmptyAttrRec, hsTag: "WRD_GENDER", tag: "wrdGender", fullTag: "wrdGender", attributetype: WRDBaseAttributeTypeId.Base_Gender, allowedvalues: "male\tfemale\tother" },
      { ...baseEmptyAttrRec, hsTag: "WRD_FULLNAME", tag: "wrdFullName", fullTag: "wrdFullName", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString, isreadonly: true },
      { ...baseEmptyAttrRec, hsTag: "WRD_TITLES", tag: "wrdTitles", fullTag: "wrdTitles", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_INITIALS", tag: "wrdInitials", fullTag: "wrdInitials", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_FIRSTNAME", tag: "wrdFirstName", fullTag: "wrdFirstName", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_FIRSTNAMES", tag: "wrdFirstNames", fullTag: "wrdFirstNames", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_INFIX", tag: "wrdInfix", fullTag: "wrdInfix", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_INFIX", tag: "wrdLastNamePrefix", fullTag: "wrdLastNamePrefix", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_LASTNAME", tag: "wrdLastName", fullTag: "wrdLastName", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_TITLES_SUFFIX", tag: "wrdTitlesSuffix", fullTag: "wrdTitlesSuffix", attributetype: WRDBaseAttributeTypeId.Base_NameString },
      { ...baseEmptyAttrRec, hsTag: "WRD_DATEOFBIRTH", tag: "wrdDateOfBirth", fullTag: "wrdDateOfBirth", attributetype: WRDBaseAttributeTypeId.Base_Date },
      { ...baseEmptyAttrRec, hsTag: "WRD_DATEOFDEATH", tag: "wrdDateOfDeath", fullTag: "wrdDateOfDeath", attributetype: WRDBaseAttributeTypeId.Base_Date },
    ]);
  }
  if (type.tag === "wrdRelation")
    attrs.push({ ...baseEmptyAttrRec, hsTag: "WRD_TITLE", tag: "wrdTitle", fullTag: "wrdTitle", attributetype: WRDBaseAttributeTypeId.Base_GeneratedString, isreadonly: true });

  return attrs;
}

export async function schemaExists(tag: string): Promise<boolean> {
  const schema = await db<PlatformDB>()
    .selectFrom("wrd.schemas")
    .select(["id"]) //we need to select *something* or the PG/Kysely integration goes boom
    .where("name", "=", tag)
    .executeTakeFirst();
  return Boolean(schema);
}

export async function getSchemaData(tag: string): Promise<SchemaData> {
  let schemaquery = db<PlatformDB>()
    .selectFrom("wrd.schemas")
    .select(selectSchemaColumns);
  schemaquery = schemaquery.where("name", "=", tag);
  const schema = await schemaquery.executeTakeFirst();
  if (!schema)
    throw new Error(`No such schema ${JSON.stringify(tag)}`);

  //Get types, prepare their objects (TODO proper classes for these typeobjects containing attrRootAttrMap etc)
  const types: TypeRec[] = (await db<PlatformDB>()
    .selectFrom("wrd.types")
    .select(selectTypeColumns)
    .where("wrd_schema", "=", schema.id)
    .orderBy("id")
    .execute()).map(type => ({
      ...type,
      schemaId: schema.id,
      tag: tagToJS(type.tag),
      parentTypeIds: [type.id],
      childTypeIds: [type.id],
      parentAttrMap: new Map<number | null, AttrRec[]>,
      rootAttrMap: new Map<string, AttrRec>,
      attrByFullTagMap: new Map<string, AttrRec>,
      attrRootAttrMap: new Map<number, AttrRec>,
      attrHSNameMap: new Map<number, string>,
      consilioLinkCheckAttrs: new Set<number>,
      whfsLinkAttrs: new Set<number>,
      uniqueAttrs: new Set<number>,
      emailAttrs: new Set<number>,
      hsTag: type.tag
    }));
  const typeids: number[] = types.map(t => t.id);

  //Gathers *all* attributes for all types
  const attrs: AttrRec[] = (await db<PlatformDB>()
    .selectFrom("wrd.attrs")
    .select(selectAttrColumns)
    .where("type", "in", typeids)
    .orderBy("tag")
    .execute()).map(attr => ({
      ...attr,
      isreadonly: false,
      tag: tagToJS(attr.tag),
      schemaId: schema.id,
      hsTag: attr.tag
    })).map(attr => ({ ...attr, fullTag: attr.tag, attributetype: attr.attributetype as WRDBaseAttributeTypeId | WRDAttributeTypeId }));

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
      try {
        addAttribute(attr, type, tag);
      } catch (e) {
        throw new Error(`Cannot open schema ${tag}, broken type ${type.tag}: ${(e as Error).message}`, { cause: e });
      }
    }
    for (const rootAttr of type.rootAttrMap.values())
      recurseStoreRootAttrs(rootAttr, rootAttr.id, type.parentAttrMap, type.attrRootAttrMap, type.attrByFullTagMap, type.attrHSNameMap, rootAttr.tag + ".");
  }
  return {
    schema,
    typeTagMap,
    typeIdMap,
    attrs,
  };
}

function addAttribute(attr: AttrRec, type: TypeRec, tag: string) {
  if (!attr.parent) {
    type.rootAttrMap.set(attr.tag, attr);
    type.attrRootAttrMap.set(attr.id, attr);
    type.attrHSNameMap.set(attr.id, attr.hsTag);
    if (attr.id && type.attrByFullTagMap.has(attr.fullTag)) { //check for conflicts for DB stored attributes (eg wrdLeftEntity is okay to conflict)
      //It's too risky to access this schema, or at least types, with duplicate attribute tags. Need an adult to sort it out
      throw new Error(`Duplicate attribute ${attr.fullTag} (id #${attr.id})`);
    }
    type.attrByFullTagMap.set(attr.fullTag, attr);
  }
  if (attr.isunique)
    type.uniqueAttrs.add(attr.id);
  if (([WRDAttributeTypeId.RichTextDocument, WRDAttributeTypeId.Instance, WRDAttributeTypeId.URL] as number[]).includes(attr.attributetype) || attr.checklinks)
    type.consilioLinkCheckAttrs.add(attr.id);
  if (attr.attributetype === WRDAttributeTypeId.WHFSRef)
    type.whfsLinkAttrs.add(attr.id);
  if (attr.attributetype === WRDAttributeTypeId.Email)
    type.emailAttrs.add(attr.id);
}

// Set root attr for every attr, and also the fullTag
function recurseStoreRootAttrs(rootAttr: AttrRec, current: number, parentAttrMap: Map<number | null, AttrRec[]>, attrRootAttrMap: Map<number, AttrRec>, attrByFullTagMap: Map<string, AttrRec>, attrHSNameMap: Map<number, string>, attrBasePath: string) {
  const attrs = parentAttrMap.get(current);
  if (attrs)
    for (const attr of attrs) {
      attr.fullTag = attrBasePath + attr.tag;
      attrByFullTagMap.set(attr.fullTag, attr);
      attrHSNameMap.set(attr.id, tagToHS(attr.fullTag));
      attrRootAttrMap.set(attr.id, rootAttr);
      if (parentAttrMap.has(attr.id))
        recurseStoreRootAttrs(rootAttr, attr.id, parentAttrMap, attrRootAttrMap, attrByFullTagMap, attrHSNameMap, attr.fullTag + ".");
    }
}
