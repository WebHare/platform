import type { AllowedFilterConditions, MapRecordOutputMap, MapRecordOutputMapWithDefaults, RecordOutputMap, SchemaTypeDefinition } from "./types";
export { type SchemaTypeDefinition } from "./types";
import type { HistoryModeData, WRDType } from "./schema";
import { type AnyWRDAccessor, getAccessor } from "./accessors";
import { type AttrRec, type EntitySettingsRec, type EntitySettingsWHFSLinkRec, /*TypeRec, */selectEntitySettingColumns, selectEntitySettingWHFSLinkColumns } from "./db";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { recordLowerBound, recordUpperBound, recordRange } from "@webhare/hscompat/algorithms";
import { maxDateTime } from "@webhare/hscompat/datetime";
import { getUnifiedCC } from "@webhare/services/src/descriptor";
import { isPromise } from "@webhare/std";


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

function cmp<T extends number | string>(a: T, b: T) { return a === b ? 0 : a < b ? -1 : 1; }

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
      throw new Error(`Could not find attribute '${field}' in type '${type.tag}'`);
    }
    accessors.push({ field, accessor: getAccessor(attrrec, parentAttrMap) as AnyWRDAccessor });
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

export async function getDefaultJoinRecord<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]>>(
  type: WRDType<S, T>,
  selects: O
): Promise<MapRecordOutputMapWithDefaults<S[T], O>> {
  // Get the data for the whole schema
  const schemadata = await type.schema.__ensureSchemaData();

  // Lookup the type
  const typerec = schemadata.typeTagMap.get(type.tag);
  if (!typerec)
    throw new Error(`No such type ${type.getFormattedName()}`);

  // Build the output mapping
  const { map, accessors } = createSelectMap(type, selects || {}, typerec.rootAttrMap, typerec.parentAttrMap);

  // Gather the accessor values
  const accvalues = [];
  for (const acc of accessors) {
    accvalues.push(acc.accessor.getDefaultValue());
  }

  // Apply the output mapping, push the value to the results
  return applyMap(map, accvalues) as MapRecordOutputMapWithDefaults<S[T], O>;
}

export async function runSimpleWRDQuery<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]>>(
  type: WRDType<S, T>,
  selects: O,
  wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>,
  historyMode: HistoryModeData,
  limit: number | null,
) {
  if (limit !== null && limit <= 0)
    return [];

  // Get the data for the whole schema
  const schemadata = await type.schema.__ensureSchemaData();

  // Lookup the type
  const typerec = schemadata.typeTagMap.get(type.tag);
  if (!typerec)
    throw new Error(`No such type ${type.getFormattedName()}`);

  // Build the output mapping
  const { map, accessors } = createSelectMap(type, selects || {}, typerec.rootAttrMap, typerec.parentAttrMap);

  // Base entity query
  let query = db<PlatformDB>()
    .selectFrom("wrd.entities")
    .where("wrd.entities.type", "in", typerec.childTypeIds);

  // process the history mode
  switch (historyMode?.mode) {
    case undefined:
    case "now": {
      const now = new Date;
      query = query.where("creationdate", "<=", now).where("limitdate", ">", now);
    } break;
    case "active": {
      const now = new Date;
      /* creationdate <= now AND limitdate > now
         OR
         creationdate = null

         we need the outer wrapper to keep ( )s around the OR
      */
      query = query.where(qb => qb.or([
        qb.and([qb("creationdate", "<=", now), qb("limitdate", ">", now)]),
        qb("creationdate", "=", maxDateTime)
      ]));
    } break;
    case "range": {
      query = query.where("creationdate", "<=", historyMode.limit).where("limitdate", ">", historyMode.start);
    } break;
    case "at": {
      query = query.where("creationdate", "<=", historyMode.when).where("limitdate", ">", historyMode.when);
    } break;
    case "all": {
      query = query.where("creationdate", "!=", maxDateTime);
    } break;
  }

  // add more wheres
  const afterchecks: Array<typeof wheres[number] & { accessor: AnyWRDAccessor }> = [];
  for (const filter of wheres) {
    const parts = filter.field.split(".");
    let attr: AttrRec | undefined;
    for (const [idx, part] of parts.entries()) {
      attr = attr ?
        typerec.parentAttrMap.get(attr.id)?.find(a => a.tag === part) :
        typerec.rootAttrMap.get(part);
      if (!attr)
        throw new Error(`Cannot find attribute ${JSON.stringify(parts.slice(0, idx + 1))} in type ${type.getFormattedName()}`);
    }
    if (!attr)
      throw new Error(`Cannot find attribute ${JSON.stringify(filter.field)} in type ${type.getFormattedName()}`);
    if (parts.length > 1 && !["mentions", "mentionsany"].includes(filter.condition))
      throw new Error(`Condition ${JSON.stringify(filter.condition)} not allowed for field ${JSON.stringify(filter.field)} in type ${type.getFormattedName()}`);

    const accessor = getAccessor(attr, typerec.parentAttrMap);
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
  let selectquery = query.select(["wrd.entities.id", "wrd.entities.type", "wrd.entities.creationdate"]);

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
    await db<PlatformDB>()
      .selectFrom("wrd.entity_settings")
      .where("entity", "in", entities.map(e => e.id))
      .where("attribute", "in", selectattrids)
      .select(selectEntitySettingColumns)
      .orderBy("entity")
      .orderBy("attribute")
      .orderBy("parentsetting")
      .orderBy("ordering")
      .execute() :
    [];

  // TODO: get only link settings for attributes that have them, reduces size of the where array
  const links: EntitySettingsWHFSLinkRec[] = settings.length ?
    await db<PlatformDB>()
      .selectFrom("wrd.entity_settings_whfslink")
      .select(selectEntitySettingWHFSLinkColumns)
      .where("id", "in", settings.map(setting => setting.id))
      .orderBy("id")
      .execute() :
    [];

  const retval = new Array<MapRecordOutputMap<S[T], O>>;

  entityloop:
  for (const entity of entities) {
    // Slice the entity settings array for the attributes for this entity
    const entityattrs = recordRange(settings, { entity: entity.id }, ["entity"]);
    const cc = getUnifiedCC(entity.creationdate);

    // Execute the afterchecks
    for (const aftercheck of afterchecks) {
      const lb = recordLowerBound(entityattrs, { attribute: aftercheck.accessor.attr.id }, ["attribute"]);
      const ub = recordUpperBound(entityattrs, { attribute: aftercheck.accessor.attr.id }, ["attribute"]);
      const value = aftercheck.accessor.getValue(entityattrs, lb.position, ub, entity, links, cc);
      if (!aftercheck.accessor.matchesValue(value, aftercheck as never)) {
        continue entityloop;
      }
    }

    // Gather the accessor values
    const accvalues = [];
    for (const acc of accessors) {
      const lb = recordLowerBound(entityattrs, { attribute: acc.accessor.attr.id }, ["attribute"]);
      const ub = recordUpperBound(entityattrs, { attribute: acc.accessor.attr.id }, ["attribute"]);
      const value = acc.accessor.getValue(entityattrs, lb.position, ub, entity, links, cc);
      accvalues.push(isPromise(value) ? await value : value);
    }

    // Apply the output mapping, push the value to the results
    retval.push(applyMap(map, accvalues) as MapRecordOutputMap<S[T], O>);

    if (limit && retval.length >= limit)
      break;
  }

  return retval;
}
