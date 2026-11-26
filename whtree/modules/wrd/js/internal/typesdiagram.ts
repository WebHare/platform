/* Gathers the types and attributes of a WRD schema with their TypeScript names for the types diagram
   (TypesDiagram in mod::wrd/lib/screens/types.whlib, rendered by mod::wrd/js/typesdiagram/typesdiagram.ts)

   The results use lowercase keys and no nulls, as they're passed to HareScript and on to the diagram as-is
*/
import { wrd, type AnySchemaType, type WRDSchemaType } from "@webhare/wrd";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

type AnySchema = WRDSchemaType<AnySchemaType>;

interface AttrInfo {
  id: number | null;
  /** Full tag, eg 'addresses.street' */
  fullTag: string;
  /** Tag within the parent attribute, eg 'street' */
  tag: string;
  attributeType: string;
  domain: string | null;
  isRequired: boolean;
  isInherited: boolean;
  children: AttrInfo[];
}

/** The attributes of a type, as shown in the attribute list of the diagram screen */
export interface TypeAttributeRow {
  id: number;
  fulltag: string;
  tag: string;
  attributetype: string;
  domain: string;
  isrequired: boolean;
  isinherited: boolean;
  children: TypeAttributeRow[];
}

/** The types as shown in the diagram. Must match DiagramType in mod::wrd/js/typesdiagram/typesdiagram.ts */
export interface DiagramAttr {
  tag: string;
  type: "domain" | "domainarray" | "array";
  domain: number;
  isrequired: boolean;
  children: DiagramAttr[];
}

export interface DiagramType {
  id: number;
  tag: string;
  title: string;
  metatype: string;
  parenttype: number;
  linkfrom: number;
  linkto: number;
  attrs: DiagramAttr[];
}

/** Sort by uppercased tag, comparing code units like HareScript's ORDER BY ToUppercase(tag) */
const compareTags = (lhs: { tag: string }, rhs: { tag: string }) => {
  const left = lhs.tag.toUpperCase(), right = rhs.tag.toUpperCase();
  return left < right ? -1 : left > right ? 1 : 0;
};

/** List the attributes of a type as a tree, marking the attributes inherited from the parent type */
async function getAttributeTree(wrdSchema: AnySchema, typeTag: string, parentTypeTag: string | null): Promise<AttrInfo[]> {
  const wrdType = wrdSchema.getType(typeTag);
  // wrdTitle redirected to wrdOrgName is still a base attribute (as in HareScript), so it doesn't own the id it borrowed
  const isRedirected = (attr: { id: number | null; tag: string }, attrs: Array<{ id: number | null; tag: string }>) =>
    attr.tag === "wrdTitle" && attr.id !== null && attrs.some(other => other.id === attr.id && other.tag !== "wrdTitle");

  /* Inherited attributes have the same id and tag as the attribute in the parent type (base attributes have no id and are
     never inherited). Check the tag too: some base attributes are redirected to another attribute and report its id
     (wrdTitle reports the id of wrdOrgName in types derived from wrdOrganization). Skip those redirected attributes, or
     they'd replace the tag of the attribute that actually owns the id */
  const parentAttrList = parentTypeTag ? await wrdSchema.getType(parentTypeTag).listAttributes() : [];
  const parentAttrs = new Map(parentAttrList.filter(attr => attr.id !== null && !isRedirected(attr, parentAttrList)).map(attr => [attr.id, attr.tag]));

  const listLevel = async (parent: string | null, inheritedParent: boolean): Promise<AttrInfo[]> => {
    const attrs = await wrdType.listAttributes(parent);
    const result: AttrInfo[] = [];
    for (const attr of attrs) {
      const id = isRedirected(attr, attrs) ? null : attr.id;
      const isInherited = inheritedParent || (id !== null && parentAttrs.get(id) === attr.tag);
      result.push({
        id,
        fullTag: attr.tag,
        tag: attr.tag.split(".").at(-1)!,
        attributeType: attr.attributeType,
        domain: attr.domain ?? null,
        isRequired: Boolean(attr.isRequired),
        isInherited,
        children: attr.attributeType === "array" ? await listLevel(attr.tag, isInherited) : []
      });
    }
    return result.sort(compareTags);
  };
  return await listLevel(null, false);
}

/** Get the types of a schema with their domain(array) attributes for the diagram, using TypeScript names */
export async function getTypesDiagramData(schemaTag: string): Promise<DiagramType[]> {
  const wrdSchema = wrd<AnySchemaType>(schemaTag);
  const types = Array.from(await wrdSchema.listTypes()).sort(compareTags);
  const typeTags = new Map(types.map(type => [type.id, type.tag]));
  const typeIds = new Map(types.map(type => [type.tag, type.id]));
  const getTypeId = (tag: string | null | undefined) => tag ? typeIds.get(tag) ?? 0 : 0;
  // Ids of types that aren't (or no longer) in the schema map to 0 (no relation), as in the HareScript mode
  const knownTypeId = (id: number | null) => id && typeTags.has(id) ? id : 0;

  /* Read the type metadata directly instead of using describeType: that throws when a link or attachment has no required
     left/right type, or when a type was deleted after listTypes() cached the schema */
  const typeRows = new Map((await db<PlatformDB>()
    .selectFrom("wrd.types")
    .select(["id", "title", "parenttype", "requiretype_left", "requiretype_right"])
    .where("wrd_schema", "=", await wrdSchema.getId())
    .execute()).map(row => [row.id, row]));

  // Only show domain and domainArray attributes, and arrays containing them. wrdLeftEntity and wrdRightEntity are drawn
  // as relations between the types, inherited attributes are shown on the parent type
  const toDiagramAttrs = (attrs: AttrInfo[]): DiagramAttr[] => {
    const result: DiagramAttr[] = [];
    for (const attr of attrs) {
      if (attr.isInherited || attr.fullTag === "wrdLeftEntity" || attr.fullTag === "wrdRightEntity")
        continue;
      if ((attr.attributeType === "domain" || attr.attributeType === "domainArray") && getTypeId(attr.domain)) {
        result.push({ tag: attr.tag, type: attr.attributeType === "domain" ? "domain" : "domainarray", domain: getTypeId(attr.domain), isrequired: attr.isRequired, children: [] });
      } else if (attr.attributeType === "array") {
        const children = toDiagramAttrs(attr.children);
        if (children.length)
          result.push({ tag: attr.tag, type: "array", domain: 0, isrequired: attr.isRequired, children });
      }
    }
    return result;
  };

  const result: DiagramType[] = [];
  for (const type of types) {
    const row = typeRows.get(type.id);
    if (!row) //deleted after listTypes() cached the schema
      continue;
    const parentType = knownTypeId(row.parenttype);
    const hasLeft = type.metaType === "link" || type.metaType === "attachment";
    result.push({
      id: type.id,
      tag: type.tag,
      title: row.title,
      metatype: type.metaType,
      parenttype: parentType,
      linkfrom: hasLeft ? knownTypeId(row.requiretype_left) : 0,
      linkto: type.metaType === "link" ? knownTypeId(row.requiretype_right) : 0,
      attrs: toDiagramAttrs(await getAttributeTree(wrdSchema, type.tag, parentType ? typeTags.get(parentType)! : null))
    });
  }
  return result;
}

/** Get all attributes of a type, using TypeScript names */
export async function getTypeAttributes(schemaTag: string, typeId: number): Promise<TypeAttributeRow[]> {
  const wrdSchema = wrd<AnySchemaType>(schemaTag);
  // Not using describeType, as it throws for links/attachments without a required left/right type
  const typeTags = new Map((await wrdSchema.listTypes()).map(type => [type.id, type.tag]));
  const typeTag = typeTags.get(typeId);
  const row = typeTag ? await db<PlatformDB>().selectFrom("wrd.types").select(["parenttype"]).where("id", "=", typeId).executeTakeFirst() : undefined;
  if (!typeTag || !row)
    return [];

  const toRows = (attrs: AttrInfo[]): TypeAttributeRow[] => attrs.map(attr => ({
    id: attr.id ?? 0,
    fulltag: attr.fullTag,
    tag: attr.tag,
    attributetype: attr.attributeType,
    domain: attr.domain ?? "",
    isrequired: attr.isRequired,
    isinherited: attr.isInherited,
    children: toRows(attr.children)
  }));
  return toRows(await getAttributeTree(wrdSchema, typeTag, (row.parenttype && typeTags.get(row.parenttype)) || null));
}
