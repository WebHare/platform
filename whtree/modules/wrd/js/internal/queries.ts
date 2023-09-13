//import { AnySchemaTypeDefinition, AllowedFilterConditions, RecordOutputMap, SchemaTypeDefinition, recordizeOutputMap, Insertable, Updatable, CombineSchemas, OutputMap, RecordizeOutputMap, GetCVPairs, MapRecordOutputMap, AttrRef, EnrichOutputMap, CombineRecordOutputMaps, combineRecordOutputMaps, WRDMetaType, WRDAttributeTypeNames } from "./types";
import { AllowedFilterConditions, MapRecordOutputMap, RecordOutputMap, SchemaTypeDefinition } from "./types";
export { SchemaTypeDefinition } from "./types";
//import { checkPromiseErrorsHandled } from "@webhare/js-api-tools";
//import { ensureScopedResource } from "@webhare/services/src/codecontexts";
//import { WRDAttributeConfiguration_HS } from "@webhare/wrd/src/wrdsupport";
//import { fieldsToHS, tagToHS, outputmapToHS, repairResultSet, tagToJS, repairResultValue, WRDAttributeConfiguration, WRDAttributeConfiguration_HS } from "@webhare/wrd/src/wrdsupport";
import type { HistoryModeData, WRDType } from "./schema";
import { getAccessor } from "./accessors";
import { AttrRec, EntitySettingsRec, EntitySettingsWHFSLinkRec, /*TypeRec, */selectEntitySettingColumns, selectEntitySettingWHFSLinkColumns } from "./db";
import { db, sql } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { recordLowerBound, recordUpperBound, recordRange } from "@webhare/hscompat/algorithms";
import { maxDateTime } from "@webhare/hscompat/datetime";


export type ReturnMap<T> = Array<{
  type: "field";
  name: string;
  field: T;
  pos: number;
} | {
  type: "map";
  name: string;
  fields: ReturnMap<T>;
}>;

function createSelectMapRecursive<SchemaType extends SchemaTypeDefinition, TypeTag extends keyof SchemaType & string, OutputMapping extends RecordOutputMap<SchemaType[TypeTag]>>(type: WRDType<SchemaType, TypeTag>, selects: OutputMapping, fields: Set<keyof SchemaType[TypeTag] & string>): ReturnMap<keyof SchemaType[TypeTag] & string> {
  const returnmap: ReturnMap<keyof SchemaType[TypeTag] & string> = [];
  for (const [name, field] of Object.entries(selects)) {
    if (typeof field === "object") {
      returnmap.push({
        type: "map",
        name,
        fields: createSelectMapRecursive(type, field, fields)
      });
    } else {
      returnmap.push({
        type: "field",
        name,
        field,
        pos: -1
      });
      fields.add(field);
    }
  }
  return returnmap;
}

function addAccessorPositions<T extends string>(m: ReturnMap<T>, accpos: Map<string, number>): void {
  for (const e of m) {
    if (e.type === "map")
      addAccessorPositions(e.fields, accpos);
    else
      e.pos = accpos.get(e.field) as number;
  }
}

function cmp<T extends number | string>(a: T, b: T) { return a == b ? 0 : a < b ? -1 : 1; }

function createSelectMap<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]>>(type: WRDType<S, T>, selects: O, rootattrs: Map<string, AttrRec>, parentAttrMap: Map<number | null, AttrRec[]>) {
  const fieldset = new Set<keyof S[T] & string>;
  let map: ReturnMap<keyof S[T] & string>;
  if (typeof selects === "string") {
    map = [
      {
        type: "field",
        name: "",
        field: selects,
        pos: -1
      }
    ];
    fieldset.add(selects);
  } else
    map = createSelectMapRecursive(type, selects, fieldset);
  const accessors = [];
  for (const field of fieldset) {
    const attrrec = rootattrs.get(field);
    if (!attrrec) {
      throw new Error(`Could not find attribute ${field}`);
    }
    accessors.push({ field, accessor: getAccessor(attrrec, parentAttrMap) });
  }
  accessors.sort((a, b) => cmp(a.accessor.attr.id, b.accessor.attr.id) ?? cmp(a.field, b.field));
  const accpos = new Map(accessors.map((a, idx) => [a.field, idx]));
  addAccessorPositions(map, accpos);
  return { accessors, map };
}

function applyMap<S>(map: ReturnMap<S>, values: unknown[]): unknown {
  const retval: Record<string, unknown> = {};
  for (const elt of map) {
    if (elt.type === "field") {
      if (!elt.name)
        return values[elt.pos];
      retval[elt.name] = values[elt.pos];
    } else
      retval[elt.name] = applyMap(elt.fields, values);
  }
  return retval;
}

export async function runSimpleWRDQuery<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]>>(
  type: WRDType<S, T>,
  selects: O,
  wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>,
  historymode: HistoryModeData,
  limit: number | null,
) {
  if (limit !== null && limit <= 0)
    return [];

  // Get the data for the whole schema
  const schemadata = await type.schema.ensureSchemaData();

  // Lookup the type
  const typerec = schemadata.typeTagMap.get(type.tag);
  if (!typerec)
    throw new Error(`No such type ${JSON.stringify(type.tag)}`);

  // Get the needed attribute maps
  const parentAttrMap = schemadata.typeParentAttrMap.get(typerec.id)!;
  const rootAttrMap = schemadata.typeRootAttrMap.get(typerec.id);
  if (!rootAttrMap) {
    // Base attributes should be present
    throw new Error(`No attributes found for type ${typerec.id}`);
  }

  // Build the output mapping
  const { map, accessors } = createSelectMap(type, selects || {}, rootAttrMap, parentAttrMap);

  // Base entity query
  let query = db<WebHareDB>()
    .selectFrom("wrd.entities")
    .where("wrd.entities.type", "=", sql`any(${typerec.childTypeIds})`);

  // process the history mode
  switch (historymode?.mode) {
    case undefined:
    case "now": {
      const now = new Date;
      query = query.where("creationdate", "<=", now).where("limitdate", ">", now);
    } break;
    case "range": {
      query = query.where("creationdate", "<=", historymode.when_limit).where("limitdate", ">", historymode.when_start);
    } break;
    case "at": {
      query = query.where("creationdate", "<=", historymode.when).where("limitdate", ">", historymode.when);
    } break;
    case "all": {
      query = query.where("creationdate", "!=", maxDateTime);
    } break;
  }

  // add more wheres
  const afterchecks: Array<typeof wheres[number] & { accessor: ReturnType<typeof getAccessor> }> = [];
  for (const filter of wheres) {
    const attr = rootAttrMap.get(filter.field);
    if (!attr)
      throw new Error(`No such attribute ${JSON.stringify(filter.field)}`);

    const accessor = getAccessor(attr, parentAttrMap);
    accessor.checkFilter(filter as never);

    const queryres = accessor.addToQuery(query, filter as never);
    if (!queryres) {
      return []; // no results!
      break;
    } else if (queryres.needaftercheck) {
      afterchecks.push({ ...filter, accessor });
    }
    query = queryres.query;
  }

  // Make sure id and type are selected too
  let selectquery = query.select(["wrd.entities.id", "wrd.entities.type"]);

  // Select all needed base fields too (for select map and afterchecks). Process every atrtribute only once.
  const selectedAttrs = new Set<string>;
  const selectattrids = new Array<number>;
  for (const field of accessors.concat(afterchecks)) {
    if (selectedAttrs.has(field.accessor.attr.tag))
      continue;
    selectedAttrs.add(field.accessor.attr.tag);

    const id = field.accessor.getAttrIds();
    if (typeof id !== "number")
      selectattrids.push(...id);
    else if (id)
      selectattrids.push(id);
    const baseCells = field.accessor.getAttrBaseCells();
    if (baseCells) {
      if (typeof baseCells !== "string")
        selectquery = selectquery.select(baseCells);
      else
        selectquery = selectquery.select([baseCells]);
    }
  }

  // If there are no afterchecks, we can limit the number of returned items in the entity select query
  if (!afterchecks.length && limit)
    selectquery = selectquery.limit(limit);

  // Execute the query if there could be results
  const entities = await selectquery.execute();
  if (!entities.length)
    return []; // no results!

  // Get required entity settings if needed
  const settings: EntitySettingsRec[] = selectattrids.length ?
    await db<WebHareDB>()
      .selectFrom("wrd.entity_settings")
      .where("entity", "=", sql`any(${entities.map(e => e.id)})`)
      .where("attribute", "=", sql`any(${selectattrids})`)
      .select(selectEntitySettingColumns)
      .orderBy("entity")
      .orderBy("attribute")
      .orderBy("parentsetting")
      .execute() :
    [];

  // TODO: get only link settings for attributes that have them, reduces size of the where array
  const links: EntitySettingsWHFSLinkRec[] = settings.length ?
    await db<WebHareDB>()
      .selectFrom("wrd.entity_settings_whfslink")
      .select(selectEntitySettingWHFSLinkColumns)
      .where("id", "=", sql`any(${settings.map(setting => setting.id)})`)
      .orderBy("id")
      .execute() :
    [];

  const retval = new Array<MapRecordOutputMap<S[T], O>>;

  entityloop:
  for (const entity of entities) {
    // Slice the entity settings array for the attributes for this entity
    const entityattrs = recordRange(settings, { entity: entity.id }, ["entity"]);

    // Execute the afterchecks
    for (const aftercheck of afterchecks) {
      const lb = recordLowerBound(entityattrs, { attribute: aftercheck.accessor.attr.id }, ["attribute"]);
      const ub = recordUpperBound(entityattrs, { attribute: aftercheck.accessor.attr.id }, ["attribute"]);
      const value = aftercheck.accessor.getValue(entityattrs, lb.position, ub, entity, links);
      if (!aftercheck.accessor.matchesValue(value, aftercheck as never)) {
        continue entityloop;
      }
    }

    // Gather the accessor values
    const accvalues = [];
    for (const acc of accessors) {
      const lb = recordLowerBound(entityattrs, { attribute: acc.accessor.attr.id }, ["attribute"]);
      const ub = recordUpperBound(entityattrs, { attribute: acc.accessor.attr.id }, ["attribute"]);
      const value = acc.accessor.getValue(entityattrs, lb.position, ub, entity, links);
      accvalues.push(value);
    }

    // Apply the output mapping, push the value to the results
    retval.push(applyMap(map, accvalues) as MapRecordOutputMap<S[T], O>);

    if (limit && retval.length >= limit)
      break;
  }

  return retval;
}
