/* eslint-disable @typescript-eslint/no-explicit-any -- too much any's needed for generic types */
import { db, nextVal, type Updateable } from "@webhare/whdb";
import { type AnySchemaTypeDefinition, type AllowedFilterConditions, type RecordOutputMap, type SchemaTypeDefinition, recordizeOutputMap, type WRDInsertable, type WRDUpdatable, type CombineSchemas, type OutputMap, type RecordizeOutputMap, type RecordizeEnrichOutputMap, type MapRecordOutputMap, type AttrRef, type EnrichOutputMap, type CombineRecordOutputMaps, combineRecordOutputMaps, WRDAttributeTypes, type MapEnrichRecordOutputMap, type MapEnrichRecordOutputMapWithDefaults, recordizeEnrichOutputMap, type MatchObjectQueryable, type EnsureExactForm, type UpsertMatchQueryable, type WhereFields, type WhereConditions, type WhereValueOptions, type WRDMetaType, WRDMetaTypes, WRDBaseAttributeTypes } from "./types";
export type { SchemaTypeDefinition } from "./types";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { ensureScopedResource, setScopedResource } from "@webhare/services/src/codecontexts";
import { tagToHS, tagToJS, checkValidWRDTag, type WRDAttributeConfiguration } from "./wrdsupport";
import { getSchemaData, schemaExists, type SchemaData } from "./db";
import { getDefaultJoinRecord, runSimpleWRDQuery } from "./queries";
import { generateRandomId, isTruthy, omit, pick, stringify, throwError } from "@webhare/std";
import { type EnrichmentResult, executeEnrichment, type RequiredKeys } from "@mod-system/js/internal/util/algorithms";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { __internalUpdEntity } from "./updates";
import whbridge from "@mod-system/js/internal/whmanager/bridge";
import { nameToCamelCase } from "@webhare/std/src/types";
import { wrdFinishHandler } from "./finishhandler";
import type { ExportOptions } from "@webhare/services/src/descriptor";

const getWRDSchemaType = Symbol("getWRDSchemaType"); //'private' but accessible by friend WRDType

const WRDCloseModes = ["close", "delete", "delete-closereferred", "delete-denyreferred", "close-denyreferred"] as const;
type WRDCloseMode = typeof WRDCloseModes[number];

interface SyncOptions {
  /** What to dot with unmatched entities during a sync? Defaults to 'keep' */
  unmatched?: WRDCloseMode | "keep";
}

interface SchemaUpdates {
  accountType?: string | null;
}

interface GetFieldsOptions extends ExportOptions {
  historyMode?: SimpleHistoryMode | HistoryModeData;
  allowMissing?: boolean;
}

interface EntityCloseOptions {
  mode?: WRDCloseMode;
}
interface WRDTypeMetadataBase {
  id: number;
  metaType: WRDMetaType;
  tag: string;
  title: string;
  deleteClosedAfter: number;
  keepHistoryDays: number;
  hasPersonalData: boolean;
  /** Tag of parent type (if any) */
  parent: string | null;
}

interface WRDObjectTypeMetadata extends WRDTypeMetadataBase {
  metaType: "object";
}

interface WRDAttachmentTypeMetadata extends WRDTypeMetadataBase {
  metaType: "attachment";
  left: string;
}

interface WRDLinkTypeMetadata extends WRDTypeMetadataBase {
  metaType: "link";
  left: string;
  right: string;
}

interface WRDDomainTypeMetadata extends WRDTypeMetadataBase {
  metaType: "domain";
}

export type WRDTypeMetadata = WRDObjectTypeMetadata | WRDAttachmentTypeMetadata | WRDLinkTypeMetadata | WRDDomainTypeMetadata;

type WRDAttributeCreateConfiguration = Pick<WRDAttributeConfiguration, 'attributeType'> & Partial<Omit<WRDAttributeConfiguration, 'attributeType'>>;

// TODO not actually a CoVM anymore but this still points to some loadlibs we need to cleanup for WRD efficiency
type CoVMSchemaCache = {
  schemaobj: Promise<HSVMObject>;
  types: Record<string, Promise<HSVMObject> | undefined>;
};

type NumberOrNullKeys<O extends object> = keyof { [K in keyof O as O[K] extends number | null ? K : never]: null } & string;

type WRDEnrichResult<
  S extends SchemaTypeDefinition,
  T extends keyof S & string,
  EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
  DataRow extends object,
  Mapping extends EnrichOutputMap<S[T]>,
  RightOuterJoin extends boolean,
> = EnrichmentResult<
  DataRow,
  EnrichKey,
  MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false>,
  never,
  true extends RightOuterJoin ? MapEnrichRecordOutputMapWithDefaults<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false> : never,
  never>;

function validateCloseMode(closeMode: string) {
  if (!WRDCloseModes.includes(closeMode as WRDCloseMode))
    throw new Error(`Illegal delete mode '${closeMode}' - must be one of: ${WRDCloseModes.join(", ")}`);
}

export function isChange(curval: any, setval: any) {
  if (curval === setval)
    return false; //not a change
  if (!curval && !setval)
    return false; //not a change (it doesn't matter whether a value is its default value or null)

  if (typeof curval === 'object') {
    if (typeof setval !== 'object')
      return false;

    //NOTE this is a heuristic, we really need attribute information to properly do this.we'll assume that an Array is a WRD array and any other Object is a JSON
    //     in a WRD Array, leaving a value out is equal to setting it to its default.
    //     in a JSON value, leaving a property out is not the same as setting it empty
    //
    if (Array.isArray(curval)) {
      if (!setval && !curval.length)
        return false;
      if (!Array.isArray(setval) || curval.length !== setval.length)
        return true; //a change
      for (const [i, row] of curval.entries()) {
        for (const [key, value] of Object.entries(row)) {
          if (isChange(value, setval[i][key])) {
            // console.log(key, value, setval[i][key]); //debug where the change appeared
            return true;
          }
        }
      }
      return false;
    } else {
      return stringify(curval, { stable: true, typed: true }) !== stringify(setval, { stable: true, typed: true });
    }
  }

  return curval !== setval;
}

type Invalidation = { type: "schema"; id: number };

function isSchemaDataInvalidatedBy(schemaData: SchemaData, invalidation: Invalidation) {
  return invalidation.type === "schema" && schemaData.schema.id === invalidation.id;
}

class SchemaUpdateListener {
  /** The collectors gather the schemadata during load, as the schema id isn't known when loading the schema but we should
   * invalidate its data when an invalidation comes in during loading
   */
  collectors = new Set<SchemaDataInvalidationCollector>;

  /** WeakMap to keep track of the schemas and their invalidation callbacks. Also the weakRef key used for the schemaDataMap, so that key is stable
   * Keep the invalidation callback here, instead as reachable property
   */
  schemaWeakMap = new WeakMap<WRDSchema<any>, { weakRef: WeakRef<WRDSchema<any>>; invalidationCallback: () => void }>();
  /// WeakMaps are not iterable, so we need to keep a separate map to be able to iterate over the schemas
  schemaDataMap = new Map<WeakRef<WRDSchema<any>>, SchemaData>();

  constructor() {
    whbridge.on("event", (event) => {
      // match wrd:schema.<id>.change events
      const match = event.name.match(/^wrd:(schema)\.(\d+)\.(change)/);
      if (!match)
        return;
      const invalidation: Invalidation = { type: "schema", id: parseInt(match[2]) };
      // Send the invalidation to the invalidation collectors
      for (const collector of this.collectors)
        collector.invalidations.push(invalidation);

      // Call the invalidation callback for all relevant schemas
      for (const [schemaWeakPtr, schemaData] of this.schemaDataMap) {
        const schema = schemaWeakPtr.deref();
        if (!schema) {
          // Schema was already garbage collected, remove it from the this.schemaDataMap
          this.schemaDataMap.delete(schemaWeakPtr);
        } else if (isSchemaDataInvalidatedBy(schemaData, invalidation)) {
          // invalidate the schemadata, remove from the schemaDataMap
          this.schemaWeakMap.get(schema)?.invalidationCallback();
          this.schemaWeakMap.delete(schema);
          this.schemaDataMap.delete(schemaWeakPtr);
        }
      }
    });
  }

  /** Register the cached data for a schema */
  addSchema(schema: WRDSchema<any>, schemaData: SchemaData, invalidations: Invalidation[], invalidationCallback: () => void) {
    // check if the schema was invalidated during loading
    const invalidated = invalidations.some(invalidation => isSchemaDataInvalidatedBy(schemaData, invalidation));
    let weakData = this.schemaWeakMap.get(schema);
    // invalidated during loading?
    if (invalidated) {
      invalidationCallback();
      if (weakData)
        this.schemaDataMap.delete(weakData.weakRef);
    } else {
      // register the schema in the schemaWeakMap and its invalidation callback
      if (!weakData)
        this.schemaWeakMap.set(schema, weakData = { weakRef: new WeakRef(schema), invalidationCallback });
      else
        weakData.invalidationCallback = invalidationCallback;
      // register in the schemaDataMap
      this.schemaDataMap.set(weakData.weakRef, schemaData);
    }
  }
}

/// Gathers a list of invalidations for a schema while running
class SchemaDataInvalidationCollector {
  listener: SchemaUpdateListener;
  invalidations: Invalidation[] = [];
  constructor(listener: SchemaUpdateListener) {
    this.listener = listener;
    listener.collectors.add(this);
  }
  [Symbol.dispose]() {
    this.listener.collectors.delete(this);
  }
}

let schemaUpdateListener: SchemaUpdateListener | null = null;

type CallbackValue<T> = T | (() => T) | (() => Promise<T>);
type UpsertOptions<T extends object, Other extends object> = object extends T ? [{ ifNew?: CallbackValue<T> } & Other] | [] : [{ ifNew: CallbackValue<T> } & Other];

export type WRDSchemaTypeOf<T extends WRDSchema<any>> = T extends WRDSchema<infer S> ? S : never;

export type AnyWRDSchema = WRDSchema<any>;

export class WRDSchema<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  readonly tag: string;
  private coVMSchemaCacheSymbol: symbol;
  private schemaData: Promise<SchemaData> | undefined;

  /** Open a WRD schema by tag */
  constructor(tag: string) {
    // We keep the 'open by tag' path sync as that's what's generally used by apps in practice. We'll see if the tag is OK once we eventually start to open schemas
    if (!tag.match(/^.+:.+$/)) //lightweight check - createSchema does deeper checking and isValidModuleScopedName is too strict to open eg. .bak schemas
      throw new Error(`Invalid schema tag '${tag}'`);

    this.tag = tag;
    this.coVMSchemaCacheSymbol = Symbol("WHCoVMSchemaCache " + this.tag);
  }

  async getId(opts: { allowMissing: true }): Promise<number | null>;
  async getId(opts?: { allowMissing?: boolean }): Promise<number>;

  async getId({ allowMissing = false } = {}): Promise<number | null> {
    if (this.schemaData)
      return (await this.schemaData).schema.id;
    const dbschema = await db<PlatformDB>().selectFrom("wrd.schemas").select(["id"]).where("name", "=", this.tag).executeTakeFirst();
    if (dbschema)
      return dbschema.id;
    else if (allowMissing)
      return null;
    else
      throw new Error(`No such WRD schema '${this.tag}'`);
  }

  /*private*/ __clearCache() {
    this.schemaData = undefined;
    setScopedResource(this.coVMSchemaCacheSymbol, undefined);
  }

  /*private*/ async __ensureSchemaData({ refresh = false } = {}): Promise<SchemaData> {
    if (!refresh && this.schemaData) {
      return this.schemaData;
    }
    schemaUpdateListener ??= new SchemaUpdateListener();
    using invalidationCollector = new SchemaDataInvalidationCollector(schemaUpdateListener);
    const data = getSchemaData(this.tag);
    this.schemaData = data;
    schemaUpdateListener.addSchema(this, await data, invalidationCollector.invalidations, () => this.__clearCache());
    return data;
  }

  /*private*/ async __toWRDTypeId(tag: string | undefined): Promise<number> {
    if (!tag)
      return 0;

    const schemaData = await this.__ensureSchemaData();
    const type = schemaData.typeTagMap.get(tag);
    if (!type)
      throw new Error(`No such type '${tag}' in schema '${this.tag}'`);
    return type.id;
  }


  async createType(tag: string, config: Partial<WRDTypeMetadata> & Pick<WRDTypeMetadata, "metaType">): Promise<WRDType<S, string>> {
    const hstag = tagToHS(tag);
    const schemaobj = await this.getWRDSchema();
    const left = await this.__toWRDTypeId((config as WRDLinkTypeMetadata)?.left);
    const right = await this.__toWRDTypeId((config as WRDLinkTypeMetadata)?.right);
    const parent = config.parent ? await this.__toWRDTypeId(config.parent) : null;

    if (config.id) //TODO I want to Omit<... "id"|"tag"> but then it won't accept left/right etc anymore...
      throw new Error("Cannot specify an id when creating a new type");
    if (config.tag) //TODO I want to Omit<... "id"|"tag"> but then it won't accept left/right etc anymore...
      throw new Error("Cannot specify tag in the configuration object when creating a new type");

    const createrequest = {
      title: "",
      description: "",
      tag: hstag,
      requiretype_left: left,
      requiretype_right: right,
      metatype: WRDMetaTypes.indexOf(config.metaType) + 1,
      parenttype: parent || 0,
      //TODO parenttype, abstract, hasperonaldata defaulting to TRUE for WRD_PERSON (but shouldn't the base schema do that?)
      deleteclosedafter: config.deleteClosedAfter || 0,
      keephistorydays: config.keepHistoryDays || 0,
      haspersonaldata: config.hasPersonalData || false
    };

    await schemaobj.__DoCreateType(createrequest);
    const type = this.getType(tag);

    //TODO schedule broadcast post commit to flush other listeners
    await this.__ensureSchemaData({ refresh: true });

    return type;
  }

  /** Describe a wrdType
   * @param tagOrId - Either the string tag or the type number to describe
   */
  async describeType(tagOrId: string | number): Promise<WRDTypeMetadata | null> {
    const schemaid = await this.getId();
    const typeinfo = await db<PlatformDB>().
      selectFrom("wrd.types").
      selectAll().
      where("wrd_schema", "=", schemaid).
      where(cb => typeof tagOrId === "string" ? cb("tag", "=", tagToHS(tagOrId)) : cb("id", "=", tagOrId)).
      executeTakeFirst();

    if (!typeinfo)
      return null;

    const retval: WRDTypeMetadata = {
      id: typeinfo.id,
      tag: tagToJS(typeinfo.tag),
      metaType: WRDMetaTypes[typeinfo.metatype - 1],
      title: typeinfo.title,
      deleteClosedAfter: typeinfo.deleteclosedafter,
      keepHistoryDays: typeinfo.keephistorydays,
      hasPersonalData: typeinfo.haspersonaldata,
      parent: typeinfo.parenttype ? await this.__getTypeTag(typeinfo.parenttype) ?? throwError(`No such type ${typeinfo.parenttype} (resolving parent for type ${this.tag}:${typeinfo.tag} (#${typeinfo.id}))`) : null
    } satisfies WRDTypeMetadataBase as WRDTypeMetadata; //TODO workaround to still get some validation even though metaType doesn't validate

    if (retval.metaType === "link" || retval.metaType === "attachment")
      retval.left = await this.__getTypeTag(typeinfo.requiretype_left || 0) ?? throwError(`No such type ${typeinfo.requiretype_left} (resolving left entity for type ${this.tag}:${typeinfo.tag} (#${typeinfo.id}))`);
    if (retval.metaType === "link")
      retval.right = await this.__getTypeTag(typeinfo.requiretype_right || 0) ?? throwError(`No such type ${typeinfo.requiretype_right} (resolving right entity for type ${this.tag}:${typeinfo.tag} (#${typeinfo.id}))`);

    return retval;
  }

  getType<T extends keyof S & string>(type: T): WRDType<S, T> {
    return new WRDType<S, T>(this, type);
  }

  async __getTypeTag(type: number): Promise<string | null> {
    const schemaData = await this.__ensureSchemaData();
    return schemaData.typeIdMap.get(type)?.tag ?? null;
  }

  async listTypes() {
    const schemaData = await this.__ensureSchemaData();
    return schemaData.typeIdMap.entries().map(([id, data]) => ({
      id,
      tag: data.tag,
      metaType: WRDMetaTypes[data.metatype - 1]
    }));
  }

  /** Test whether a type exists in this schema */
  async hasType(tag: string): Promise<boolean> {
    const schemaData = await this.__ensureSchemaData();
    return schemaData.typeTagMap.has(tag);
  }

  private getWRDSchemaCache(): CoVMSchemaCache {
    return ensureScopedResource(this.coVMSchemaCacheSymbol, (context) => ({
      schemaobj: (async () => {
        const wrd_api = loadlib("mod::wrd/lib/api.whlib"); //FIXME
        const wrdschema = await wrd_api.OpenWRDSchema(this.tag) as HSVMObject | null;
        if (!wrdschema)
          throw new Error(`No such WRD schema '${this.tag}'`);

        /* ensure listeners are in place to discard the cache where needed */
        await this.__ensureSchemaData();

        return wrdschema;
      })(),
      types: {}
    }));
  }

  private async getWRDSchema(): Promise<HSVMObject> {
    return this.getWRDSchemaCache().schemaobj;
  }

  /** Test whether this schema actually exists in the database */
  async exists(): Promise<boolean> {
    return schemaExists(this.tag);
  }

  async[getWRDSchemaType](type: string, allowMissingType: true): Promise<HSVMObject | null>;
  async[getWRDSchemaType](type: string, allowMissingType: false): Promise<HSVMObject>;

  async[getWRDSchemaType](type: string, allowMissingType: boolean): Promise<HSVMObject | null> {
    const cache: CoVMSchemaCache = this.getWRDSchemaCache();
    if (!cache.types[type]) {
      cache.types[type] = (await cache.schemaobj).getType(tagToHS(type)) as Promise<HSVMObject>;
    }
    const typeobj = await cache.types[type];
    if (!typeobj)
      if (allowMissingType)
        return null;
      else
        throw new Error(`No such type ${JSON.stringify(type)}`);
    return typeobj;
  }

  /** @deprecated use query() in WebHare 5.4.1+ */
  selectFrom<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, [], null, null);
  }

  query<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, [], null, null);
  }

  modify<T extends keyof S & string>(type: T): WRDModificationBuilder<S, T> {
    const wrdtype = this.getType(type);
    return new WRDModificationBuilder(wrdtype, [], null);
  }

  /** Reserve a wrdId */
  getNextId<T extends keyof S & string>(type: T): Promise<number> {
    return nextVal("wrd.entities.id");
  }

  /** Reserve a wrdGuid */
  getNextGuid<T extends keyof S & string>(type: T): string {
    return generateRandomId("uuidv4");
  }

  insert<T extends keyof S & string>(type: T, value: Partial<WRDInsertable<S[T]>>, options: { temp: true; importMode?: boolean }): Promise<number>;
  insert<T extends keyof S & string>(type: T, value: Partial<WRDInsertable<S[T]>>, options: { temp?: boolean; importMode: true }): Promise<number>;
  insert<T extends keyof S & string>(type: T, value: WRDInsertable<S[T]>, options?: { temp?: boolean; importMode?: boolean }): Promise<number>;

  insert<T extends keyof S & string>(type: T, value: WRDInsertable<S[T]>, options?: { temp?: boolean; importMode?: boolean }): Promise<number> {
    return this.getType(type).createEntity(value, options);
  }

  /** Updates fields of a specific entity
   * @param entity - wrdId of the entity to update, or a query object to find the entity (throws if none or multiple entities match the query)
   * @param value - Value to match (using condition "=")
   * @param options - Additional options for the filter
   * @example
   * ```typescript
   * /// Returns the wrdId of an entity with the first name "John" (or null if no such entity exists)
   * const result = await schema.search("wrdPerson", "wrdFirstName", "John");
   * ```
   */
  update<T extends keyof S & string>(type: T, entity: number | MatchObjectQueryable<S[T]>, value: WRDUpdatable<S[T]>, options?: { importMode?: boolean }): Promise<void> {
    return this.getType(type).updateEntity(entity, value, options);
  }

  /** Insert an entity, or update if it exists */
  upsert<T extends keyof S & string, Q extends object, U extends object>(type: T, query: Q & EnsureExactForm<Q, UpsertMatchQueryable<S[T]>>, value: U & EnsureExactForm<U, WRDUpdatable<S[T]>>, ...options: UpsertOptions<Omit<WRDInsertable<S[T]>, RequiredKeys<Q> | RequiredKeys<U>>, { historyMode?: SimpleHistoryMode | HistoryModeData }>): Promise<[number, boolean]> {
    /* The '...options' construction is used to make ifNew only optional if you've set all required keys. Haven't found a way to it with options?
       Unfortunately this does give confusing errors if you forget a required paramteer:
       Expected 4 arguments, but got 3.ts(2554)
       Arguments for the rest parameter 'options' were not provided.
    */
    return this.getType(type).upsert(query, value, ...options);
  }

  /** Returns the wrdId of an entity that has a field with a specific value, or null if not found.
   * @param field - Field to filter on
   * @param value - Value to match (using condition "=")
   * @param options - Additional options for the filter
   * @example
   * ```typescript
   * /// Returns the wrdId of an entity with the first name "John" (or null if no such entity exists)
   * const result = await schema.search("wrdPerson", "wrdFirstName", "John");
   * ```
   */
  search<T extends keyof S & string, F extends AttrRef<S[T]>>(type: T, field: F, value: WhereValueOptions<S[T], F, WhereConditions<S[T], F> & "=">["value"], options?: GetOptionsIfExists<WhereValueOptions<S[T], F, WhereConditions<S[T], F> & "=">, object> & { historyMode?: SimpleHistoryMode | HistoryModeData }): Promise<number | null> {
    return this.getType(type).search(field, value, options);
  }

  /** Returns the wrdId of the entity that matches the properties of the query object.
   * @param type - Type to search in
   * @param query - Query object (field-value pairs)
   * @param options - Options for the search
   */
  find<T extends keyof S & string>(type: T, query: MatchObjectQueryable<S[T]>, options?: { historyMode?: SimpleHistoryMode | HistoryModeData }): Promise<number | null> {
    return this.getType(type).find(query, options);
  }

  // Overloads: allowMisisng controls null or not, export controls export flag setting

  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M, options: GetFieldsOptions & { allowMissing: true; export: true }): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, true> | null>;
  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M, options: GetFieldsOptions & { allowMissing: true; export?: false | undefined }): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, false> | null>;
  // async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M, options: GetFieldsOptions & { allowMissing: true }): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>> | null>;
  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M, options: GetFieldsOptions & { export: true }): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, true>>;
  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M, options: GetFieldsOptions & { export?: false | undefined }): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, false>>;
  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, false>>;
  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string, Export extends boolean>(type: T, id: number, mapping: M, options?: GetFieldsOptions): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, Export> | null>;

  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string, Export extends boolean>(type: T, id: number, mapping: M, options?: GetFieldsOptions): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, Export> | null> {
    const rows: Array<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>, Export>> = await this.query(type)
      .select(mapping)
      .where("wrdId" as any, "=" as any, id as any)
      .historyMode(options?.historyMode || "active")
      .execute({ export: options?.export || false });

    if (rows.length)
      return rows[0];

    if (options?.allowMissing)
      return null;

    throw new Error(`No such ${type} #${id} in schema ${this.tag}`);
  }

  enrich<
    T extends keyof S & string,
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    DataRow extends { [K in EnrichKey]: number | null },
    Mapping extends EnrichOutputMap<S[T]>,
    RightOuterJoin extends boolean = false,
  >(
    type: T,
    data: DataRow[],
    field: EnrichKey,
    mapping: Mapping,
    options: {
      rightOuterJoin?: RightOuterJoin;
      historyMode?: SimpleHistoryMode | HistoryModeData;
    } = {}
  ): WRDEnrichResult<S, T, EnrichKey, DataRow, Mapping, RightOuterJoin> {
    return this.getType(type).enrich(data, field, mapping, options);
  }

  close<T extends keyof S & string>(type: T, ids: number | number[], options?: EntityCloseOptions): Promise<void> {
    return this.getType(type).close(ids, options);
  }

  delete<T extends keyof S & string>(type: T, ids: number | number[]): Promise<void> {
    return this.getType(type).close(ids, { mode: "delete" });
  }

  extendWith<T extends SchemaTypeDefinition>(): WRDSchema<CombineSchemas<S, T>> {
    return this as unknown as WRDSchema<CombineSchemas<S, T>>;
  }

  async getEventMasks(type: keyof S & string | Array<keyof S & string>): Promise<string[]> {
    type = Array.isArray(type) ? type : [type];
    const schemadata = await this.__ensureSchemaData();
    const retval = new Set<string>([`wrd:schema.${schemadata.schema.id}.change`]);
    for (const tag of type) {
      const typeRec = schemadata.typeTagMap.get(tag);
      if (!typeRec)
        throw new Error(`No such type ${JSON.stringify(tag)}`);
      for (const childId of typeRec.childTypeIds)
        retval.add(`wrd:type.${childId}.change`);
    }
    return Array.from(retval).sort();
  }

  async updateSchema(updates: SchemaUpdates) {
    let dbUpdate: Updateable<PlatformDB["wrd.schemas"]> | undefined;
    if (updates.accountType) {
      const typeid = (await this.describeType(updates.accountType))?.id;
      dbUpdate = { ...dbUpdate, accounttype: typeid };
    } else if (updates.accountType === null) {
      dbUpdate = { ...dbUpdate, accounttype: null };
    }

    if (dbUpdate) {
      const updated = await db<PlatformDB>().
        updateTable("wrd.schemas").
        set(dbUpdate).
        where("name", "=", this.tag).
        returning("id").
        executeTakeFirstOrThrow();

      wrdFinishHandler().schemaMetadataChanged(updated.id);
    }
  }
}


export type AnyWRDType = WRDType<any, any>;

export class WRDType<S extends SchemaTypeDefinition, T extends keyof S & string> {
  schema: WRDSchema<S>;
  tag: T;

  constructor(schema: WRDSchema<S>, tag: T) {
    this.schema = schema;
    this.tag = tag;
  }

  /** Test whether this type actually exists in the database */
  async exists() {
    const schemaid = await this.schema.getId();
    const typeinfo = await db<PlatformDB>().
      selectFrom("wrd.types").
      select(["id"]). //we need to select *something* or the PG/Kysely integration goes boom
      where("wrd_schema", "=", schemaid).
      where("tag", "=", tagToHS(this.tag)).
      executeTakeFirst();

    return Boolean(typeinfo);
  }

  async _getType() {
    return this.schema[getWRDSchemaType](this.tag, false);
  }

  async listAttributes(parent?: number | string | null): Promise<WRDAttributeConfiguration[]> {
    if (typeof parent === "string")
      checkValidWRDTag(parent, { allowMultiLevel: true });
    const schemadata = await this.schema.__ensureSchemaData();
    const typeRec = schemadata.typeTagMap.get(this.tag);
    if (!typeRec)
      throw new Error(`No such type ${JSON.stringify(this.tag)}`);

    if (typeof parent === "string") {
      const parentId = typeRec?.attrByFullTagMap.get(parent)?.id;
      if (!parentId)
        throw new Error(`No such parent attribute ${JSON.stringify(parent)} in type ${this.tag}`);
      parent = parentId;
    }

    const attrRecs = parent ?
      typeRec?.parentAttrMap.get(parent) ?? [] :
      typeRec?.rootAttrMap.values().toArray() ?? [];

    return attrRecs.map((attrRec): WRDAttributeConfiguration => ({
      id: attrRec.id || null,
      tag: attrRec.fullTag,
      attributeType: attrRec.attributetype > 0 ? WRDAttributeTypes[attrRec.attributetype - 1] : WRDBaseAttributeTypes[-attrRec.attributetype - 1],
      checkLinks: attrRec.checklinks,
      domain: attrRec.domain ? schemadata.typeIdMap.get(attrRec.domain)?.tag ?? null : null,
      isUnsafeToCopy: attrRec.isunsafetocopy,
      isRequired: attrRec.required,
      isOrdered: attrRec.ordered,
      isUnique: attrRec.isunique,
      allowedValues: attrRec.allowedvalues ? attrRec.allowedvalues.split("\t") : [],
    }));
  }

  async updateMetadata(newmetadata: Partial<Omit<WRDTypeMetadata, "id" | "metaType">>) {
    await (await this._getType()).updateMetadata(newmetadata);
  }

  async createEntity(value: WRDInsertable<S[T]>, options?: { temp?: boolean; importMode?: boolean }): Promise<number> {
    const res = await __internalUpdEntity(this, value, 0, options || {});
    return res.entityId;
  }

  async updateEntity(entity: number | MatchObjectQueryable<S[T]>, value: WRDUpdatable<S[T]>, options?: { importMode?: boolean }): Promise<void> {
    if (typeof entity === "object") {
      const matches = await this.schema.query(this.tag).select("wrdId").match(entity).execute();
      if (matches.length !== 1)
        throw new Error(`Expected exactly one match for update, got ${matches.length}`);
      entity = matches[0] as number;
    }

    //Updatable and Insertable only differ in practice on wrdId, so check for wrdId and then cast
    if ("wrdId" in value)
      throw new Error(`An entity update may not set wrdId`);
    await __internalUpdEntity(this, value as WRDInsertable<S[T]>, entity, options || {});
  }

  async upsert<Q extends object, U extends object>(query: Q & EnsureExactForm<Q, UpsertMatchQueryable<S[T]>>, value: U & EnsureExactForm<U, WRDUpdatable<S[T]>>, ...options: UpsertOptions<Omit<WRDInsertable<S[T]>, RequiredKeys<Q> | RequiredKeys<U>>, { historyMode?: SimpleHistoryMode | HistoryModeData }>): Promise<[number, boolean]> {
    if (Array.isArray(query)) {
      // @ts-expect-error Fallback code for old upsert function signature. remove in WH5.7 or when all modules are updated
      [query, value] = [pick(value, query), omit(value, query)];
    }
    const result = await this.schema.query(this.tag).select("wrdId").match(query).historyMode(options[0]?.historyMode ?? "now").execute() as number[];
    if (result.length > 1) {
      const schemaVar = nameToCamelCase(`${this.schema.tag.replace(":", "_")}_schema`);
      throw new Error(`Query ${schemaVar}.upsert(${JSON.stringify(query)}, ...) matched ${result.length} entities, at most one is allowed`);
    }

    if ("wrdLimitDate" in value && value.wrdLimitDate === null && options[0]?.historyMode !== "all")
      throw new Error(`Resetting wrdLimitDate requires historyMode: all`);

    if (result.length === 1) {
      await this.updateEntity(result[0], value);
      return [result[0], false];
    }

    const newValue = typeof options[0]?.ifNew === "function" ? await options[0].ifNew() : options[0]?.ifNew;

    /* TODO: verify if all updatable / queryable values can be converted to insertable values */
    const newId = await this.createEntity({ ...query, ...value, ...newValue } as unknown as WRDInsertable<S[T]>);
    return [newId, true];
  }

  async search<F extends AttrRef<S[T]>>(field: F, value: WhereValueOptions<S[T], F, WhereConditions<S[T], F> & "=">["value"], options?: GetOptionsIfExists<WhereValueOptions<S[T], F, WhereConditions<S[T], F> & "=">, object> & { historyMode?: SimpleHistoryMode | HistoryModeData }): Promise<number | null> {
    const historyMode = toHistoryData(options?.historyMode ?? "now");
    type FilterOverride = { field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown };
    const list = await runSimpleWRDQuery(this, "wrdId", [{ field, condition: "=", value, options } as FilterOverride], historyMode, 1);
    return list.length ? list[0] as number : null;
  }

  /** Returns the wrdId of the entity that matches the properties of the query object.
   * @param query - Query object (field-value pairs)
   * @param options - Options for the search
   */
  find(query: MatchObjectQueryable<S[T]>, options?: { historyMode?: SimpleHistoryMode | HistoryModeData }): Promise<number | null> {
    const baseQuery = this.schema.query(this.tag).select("wrdId").match(query).historyMode(options?.historyMode ?? "now");
    return baseQuery.executeRequireAtMostOne() as Promise<number | null>;
  }

  private async getBulkFields<Mapping extends EnrichOutputMap<S[T]>, Id extends number | null>(
    enrichMapping: Mapping,
    ids: Id[],
    isLeftOuterJoin: boolean,
    matchCase: boolean, //FIXME unused and thus untested...
    historyMode: HistoryModeData): Promise<Map<Id, MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false>>> {
    const vals = await runSimpleWRDQuery(
      this,
      { __joinId: "wrdId", data: recordizeEnrichOutputMap(enrichMapping) },
      isLeftOuterJoin ? [] : [{ field: "wrdId", condition: "in", value: ids.filter(isTruthy) }],
      historyMode,
      null) as Array<{ __joinId: Id; data: MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false> }>;

    return new Map(vals.map(row => [row.__joinId, row.data]));
  }

  async enrich<
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    DataRow extends { [K in EnrichKey]: number | null },
    Mapping extends EnrichOutputMap<S[T]>,
    RightOuterJoin extends boolean = false,
  >(
    data: DataRow[],
    field: EnrichKey,
    mapping: Mapping,
    options: {
      rightOuterJoin?: RightOuterJoin;
      historyMode?: SimpleHistoryMode | HistoryModeData;
    } = {}
  ): WRDEnrichResult<
    S,
    T,
    EnrichKey,
    DataRow,
    Mapping,
    RightOuterJoin
  > {
    type RetVal = ReturnType<typeof this.enrich< EnrichKey, DataRow, Mapping, RightOuterJoin>>;

    type RightOuterJoinType = true extends RightOuterJoin ?
      never :
      MapEnrichRecordOutputMapWithDefaults<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false>;

    const historyMode = toHistoryData(options.historyMode ?? "now");

    const rightOuterJoin = (options.rightOuterJoin ?
      () => {
        const recordizedOutputMap = recordizeOutputMap(mapping);
        return getDefaultJoinRecord(this, recordizedOutputMap);
      } : null) as (() => RightOuterJoinType) | null;

    const result = executeEnrichment<
      DataRow,
      EnrichKey,
      MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>, false>,
      never,
      RightOuterJoinType,
      never>(
        data,
        field,
        {},
        (ids, isLeftOuterJoin, matchCase) => this.getBulkFields(mapping, ids, isLeftOuterJoin, matchCase, historyMode),
        null,
        rightOuterJoin,
      );

    return result as RetVal;
  }

  async isReferenced(id: number): Promise<boolean> {
    if (!id)
      return false;

    if (await db<PlatformDB>().selectFrom("wrd.entities").select("id").where("leftentity", "=", id).where("id", "!=", id).executeTakeFirst())
      return true;
    if (await db<PlatformDB>().selectFrom("wrd.entities").select("id").where("rightentity", "=", id).where("id", "!=", id).executeTakeFirst())
      return true;
    if (await db<PlatformDB>().selectFrom("wrd.entity_settings").select("id").where("setting", "=", id).where("entity", "!=", id).executeTakeFirst())
      return true;

    return false;
  }

  private async __closeEntities(ids: number[], closeAt: Date): Promise<void> {
    for (const id of ids) {
      //@ts-ignore WRD doesn't recgonize wrdLimitDate as existing everywhere
      await this.updateEntity(id, { wrdLimitDate: closeAt });
    }
  }

  private async __deleteEntities(ids: number[]): Promise<void> {
    const schemadata = await this.schema.__ensureSchemaData();
    const typeRec = schemadata.typeTagMap.get(this.tag);
    if (!typeRec)
      throw new Error(`No such type ${JSON.stringify(this.tag)}`);

    await db<PlatformDB>().deleteFrom("wrd.entities").where("id", "in", ids).execute();
    for (const id of ids)
      wrdFinishHandler().entityDeleted(schemadata.schema.id, typeRec.id, id);
    return;
  }

  async close(ids: number | number[], options?: EntityCloseOptions): Promise<void> {
    const closeMode = options?.mode ?? "close";
    validateCloseMode(closeMode);

    ids = Array.isArray(ids) ? ids : [ids];
    if (!ids.length)
      return;

    if (closeMode === "delete")
      return this.__deleteEntities(ids);
    if (closeMode === "close")
      return this.__closeEntities(ids, new Date);

    const toclose: number[] = [], todelete: number[] = [];

    for (const id of ids) {
      const isreferred = await this.isReferenced(id); //TODO add bulk checker
      switch (closeMode) {
        case "close-denyreferred":
          if (isreferred)
            throw new Error(`Entity ${id} cannot be closed, it is still being referred`);

          toclose.push(id);
          break;

        case "delete-closereferred":
          (isreferred ? toclose : todelete).push(id);
          break;

        case "delete-denyreferred":
          if (isreferred)
            throw new Error(`Entity ${id} cannot be deleted, it is still being referred`);

          todelete.push(id);
          break;
      }
    }

    if (todelete.length)
      await this.__deleteEntities(ids);
    if (toclose.length)
      await this.__closeEntities(ids, new Date);
  }

  async describeAttribute(tag: string): Promise<WRDAttributeConfiguration | null> {
    checkValidWRDTag(tag, { allowMultiLevel: true });
    const schemaData = await this.schema.__ensureSchemaData();
    const typeRec = schemaData.typeTagMap.get(this.tag);
    if (!typeRec)
      throw new Error(`No such type ${JSON.stringify(this.tag)}`);
    const attrRec = typeRec.attrByFullTagMap.get(tag);
    if (!attrRec)
      return null;

    return {
      id: attrRec.id || null,
      tag: attrRec.fullTag,
      attributeType: attrRec.attributetype > 0 ? WRDAttributeTypes[attrRec.attributetype - 1] : WRDBaseAttributeTypes[-attrRec.attributetype - 1],
      checkLinks: attrRec.checklinks,
      domain: attrRec.domain ? schemaData.typeIdMap.get(attrRec.domain)?.tag ?? null : null,
      isUnsafeToCopy: attrRec.isunsafetocopy,
      isRequired: attrRec.required,
      isOrdered: attrRec.ordered,
      isUnique: attrRec.isunique,
      allowedValues: attrRec.allowedvalues ? attrRec.allowedvalues.split("\t") : [],
    };
  }

  async createAttribute(tag: string, configuration: WRDAttributeCreateConfiguration) {
    const typeobj = await this._getType();
    const typetag = configuration.attributeType;

    const configclone: Omit<Partial<WRDAttributeConfiguration>, 'domain'> & { domain?: string | number | null } = configuration;
    delete configclone.attributeType;

    if (configuration.domain)
      configclone.domain = await this.schema.__toWRDTypeId(configuration.domain);

    await typeobj.CreateAttribute(tagToHS(tag), typetag, configclone);

    //TODO schedule broadcast post commit to flush other listeners
    await this.schema.__ensureSchemaData({ refresh: true });
  }

  async updateAttribute(tag: string, configuration: Partial<WRDAttributeConfiguration>) {
    const typeobj = await this._getType();
    await typeobj.UpdateAttribute(tagToHS(tag), configuration);
    await this.schema.__ensureSchemaData({ refresh: true });
  }

  async deleteAttribute(tag: string) {
    const typeobj = await this._getType();
    await typeobj.DeleteAttribute(tagToHS(tag));
    await this.schema.__ensureSchemaData({ refresh: true });
  }

  async getEventMasks(): Promise<string[]> {
    const schemadata = await this.schema.__ensureSchemaData();
    const typeRec = schemadata.typeTagMap.get(this.tag);
    if (!typeRec)
      throw new Error(`No such type ${JSON.stringify(this.tag)}`);

    return [
      `wrd:schema.${typeRec.schemaId}.change`,
      ...typeRec.childTypeIds.map(id => `wrd:type.${id}.change`),
    ].sort();
  }

  /** Get the name to us in error messages */
  getFormattedName() {
    return `'${this.schema.tag}.${this.tag}'`;
  }
}

/** Simple history modes:
 * now: Only show currently visible entities (the default for queryFrom)
 * all: Show all entities, including past and future - but no temporaries
 * active: Show all entities that are now visible plus any temporaries (the default for getFields).
 */
export type SimpleHistoryMode = "now" | "all" | "active" | "unfiltered"; //'active' because that doesn't really suggest 'time' as much as 'now' or 'at'
export type HistoryModeData = { mode: SimpleHistoryMode } | { mode: "at"; when: Date } | { mode: "range"; start: Date; limit: Date } | null;
type GetOptionsIfExists<T, Fallback> = T extends { options?: any } ? T["options"] : Fallback;

type QueryReturnArrayType<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null, Export extends boolean> = O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O, Export>> : never;
type QueryReturnRowType<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null, Export extends boolean> = O extends RecordOutputMap<S[T]> ? MapRecordOutputMap<S[T], O, Export> : never;

function toHistoryData(mode: SimpleHistoryMode | HistoryModeData): HistoryModeData {
  return typeof mode === "string" ? { mode } : mode;
}

export class WRDQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string> {
  protected type: WRDType<S, T>;
  protected wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown; options: unknown }>;
  protected _historyMode: HistoryModeData;

  constructor(type: WRDType<S, T>, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown; options: unknown }>, historyMode: HistoryModeData) {
    this.type = type;
    this.wheres = wheres;
    this._historyMode = historyMode;
  }
}

export class WRDModificationBuilder<S extends SchemaTypeDefinition, T extends keyof S & string> extends WRDQueryBuilder<S, T> {
  //TODO can we share more of where / $call / historyMode with WRDSingleQueryBuilder?

  private __select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, RecordizeOutputMap<S[T], M>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.type, recordmapping, this.wheres, this._historyMode, null);
  }

  /** Match only the entities for which the field meets the specified condition
   * @param field - Field to filter on
   * @param condition - Condition to match
   * @param value - Value to match
   * @param options - Additional options for the filter
   * @example
   * ```typescript
   * /// Returns an array of all wrdIds of entities with the first name "John".
   * const result = await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "John").execute();
   * /// Returns an array of all wrdIds of entities that are born before 1980.
   * const result = await schema.query("wrdPerson").select("wrdId").where("wrdBirthDate", "&lt;", new Date(1980, 0, 1)).execute();
   * ```
   */
  where<Field extends WhereFields<S[T]>, Condition extends WhereConditions<S[T], Field>>(field: Field, condition: Condition, value: WhereValueOptions<S[T], Field, Condition>["value"], options?: GetOptionsIfExists<WhereValueOptions<S[T], Field, Condition>, object>): WRDModificationBuilder<S, T> {
    return new WRDModificationBuilder<S, T>(this.type, [...this.wheres, { field, condition, value, options }], this._historyMode);
  }

  /** Match only the entities that match all the properties in the specified object.
   * @param obj - Object with field-value pairs to match
   * @example
   * ```typescript
   * /// Returns an array of all wrdIds of entities with the first name "John" and last name "Doe".
   * const result = await schema.query("wrdPerson").select("wrdId").match({ wrdFirstName: "John", wrdLastName: "Doe" }).execute()
   * ```
   */
  match(obj: MatchObjectQueryable<S[T]>): WRDModificationBuilder<S, T> {
    const newWheres = Object.entries(obj).map(([field, value]) => ({ field, condition: "=" as const, value, options: undefined }));
    return new WRDModificationBuilder<S, T>(this.type, [...this.wheres, ...newWheres], this._historyMode);
  }

  $call(cb: (b: WRDModificationBuilder<S, T>) => WRDModificationBuilder<S, T>): WRDModificationBuilder<S, T> {
    return cb(this);
  }

  /*** Set the history mode for this query
   * @param mode - History mode
   * - "now": Only show currently visible entities
   * - "all": Show all entities, including past and future - but no temporaries
   * - `{ mode: "now" }`: Only show currently visible entities
   * - `{ mode: "all" }`: Show all entities, including past and future - but no temporaries
   * - `{ mode: "active" }`: Show all entities that are now visible plus any temporaries
   * - `{ mode: "unfiltered" }`: Show all entities (including invisible and temporaries)
   * - `{ mode: "at", when: Date }`: Show all entities that were visible at a specific time
   * - `{ mode: "range", start: Date, limit: Date }`: Show all entities that were visible anywhere in a range of time
   */
  historyMode(mode: SimpleHistoryMode | HistoryModeData): WRDModificationBuilder<S, T>;

  /*** Set the history mode for this query to show all entities that were visible at a specific time
   * @param mode - "at": Show all entities that were visible at a specific time
   * @param when - The time at which the entities are/were visible
  */
  historyMode(mode: "at", when: Date): WRDModificationBuilder<S, T>;

  /*** Set the history mode for this query to show all entities that were visible anywhere in a range of time
   * @param mode - "range": Show all entities that were visible anywhere in a range of time
   * @param start - Start of the range
   * @param limit - End of the range
  */
  historyMode(mode: "range", start: Date, limit: Date): WRDModificationBuilder<S, T>;

  historyMode(mode: SimpleHistoryMode | "at" | "range" | HistoryModeData, start?: Date, limit?: Date): WRDModificationBuilder<S, T> {
    if (typeof mode === "object")
      return new WRDModificationBuilder(this.type, this.wheres, mode);
    switch (mode) {
      case "active":
      case "all":
      case "now":
      case "unfiltered": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode });
      }
      case "at": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode, when: start! });
      }
      case "range": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode, start: start!, limit: limit! });
      }
    }
  }

  async sync<F extends AttrRef<S[T]>>(joinAttribute: F, inrows: Array<WRDInsertable<S[T]>>, options?: SyncOptions) {
    const retval = {
      created: new Array<number>,
      updated: new Array<number>,
      unmatched: new Array<number>,
      matched: new Array<number>
    };

    const unmatchedCloseMode = options?.unmatched || "keep";
    if (unmatchedCloseMode !== 'keep')
      validateCloseMode(unmatchedCloseMode);

    //gather rows to sync
    const currentCells = new Set<string>;
    for (const row of inrows)
      for (const key of Object.keys(row))
        if (key !== joinAttribute)
          currentCells.add(key);

    const outputColumns = {
      wrdId: "wrdId",
      wrdLimitDate: "wrdLimitDate",
      joinField: joinAttribute,
      current: [...currentCells]
    };

    //TODO we should filter on joinField too or make this a two stage select. we don't need the currentcells for entities we won't be updating
    const currentRows: any[] = await this.__select(outputColumns).execute();
    const now = new Date();
    const currentRowMap = new Map<unknown, typeof currentRows[number]>();

    for (const row of currentRows) { //Build map but watch for duplicates that will prevent proper matching
      if (currentRowMap.has(row.joinField))
        throw new Error(`Duplicate joinField '${row.joinField.toString()}' in current data (entity #${row.wrdId} and ${currentRowMap.get(row.joinField)!.wrdId})`);
      currentRowMap.set(row.joinField, row);
    }

    const inrowKeys = new Map<unknown, number>;
    for (const [idx, row] of inrows.entries()) {
      //@ts-expect-error yes it exists?
      const rowkey = row[joinAttribute];
      if (!rowkey)
        throw new Error(`Import row #${idx} has no value for '${joinAttribute}'`);
      if (inrowKeys.has(rowkey))
        throw new Error(`Duplicate joinField '${rowkey.toString()}' in imported data (row #${inrowKeys.get(rowkey)} and #${idx})`);
      inrowKeys.set(rowkey, idx);
    }

    const expectedKeys = new Set;
    for (const inrow of inrows as any[]) {
      if (!(joinAttribute in inrow))
        throw new Error(`ImportEntities: joinAttribute ${joinAttribute} not found in input row`);

      //FIXME warn if joinAttribute is not unique in source data
      const inrowkey = inrow[joinAttribute as string];
      expectedKeys.add(inrowkey);

      const currentRow: any = currentRowMap.get(inrowkey);

      if (!currentRow) { //it's a new entity
        const newid = await this.type.createEntity({ wrdCreationDate: now, wrdModificationDate: now, ...inrow });
        retval.created.push(newid);
      } else { //we may have to update the existing entity
        const changes: any = {};
        if (currentRow.wrdLimitDate)
          changes.wrdLimitDate = null;

        for (const key of currentCells)
          if (key in inrow && isChange(currentRow.current[key], inrow[key]))
            changes[key] = inrow[key];

        if (Object.keys(changes).length) { // we need to update
          await this.type.updateEntity(currentRow.wrdId, changes);
          retval.updated.push(currentRow.wrdId);
        } else {
          retval.matched.push(currentRow.wrdId);
        }
      } //done update

      currentRowMap.delete(inrowkey);
    }

    //@ts-ignore -- too complex
    const unreferenced = [...currentRowMap.values()].map(_ => _.wrdId);
    retval.unmatched = unreferenced;
    if (retval.unmatched.length && unmatchedCloseMode !== 'keep')
      await this.type.close(retval.unmatched, { mode: unmatchedCloseMode });

    return retval;
  }
}

/* The query object. We are initially created by selectFrom() with an O === null - select() then recreates us with a set O
*/
export class WRDSingleQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> extends WRDQueryBuilder<S, T> {
  private selects: O;
  private _limit: number | null;

  constructor(type: WRDType<S, T>, selects: O, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown; options: unknown }>, historyMode: HistoryModeData, limit: number | null) {
    super(type, wheres, historyMode);
    this.selects = selects;
    this._limit = limit;
  }

  private describeQuery() {
    const schemaVar = nameToCamelCase(`${this.type.schema.tag.replace(":", "_")} _schema`);
    return `${schemaVar}.query(${JSON.stringify(this.type.tag)}).select(${JSON.stringify(this.selects)})${this.wheres.map(_ => `.where(${JSON.stringify(_.field)}, ${JSON.stringify(_.condition)}, ${JSON.stringify(_.value)})`).join("")}${this._historyMode ? `.historyMode(${JSON.stringify(this._historyMode)})` : ""}${this._limit !== null ? `.limit(${this._limit})` : ""}`;
  }

  select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, CombineRecordOutputMaps<S[T], O, RecordizeOutputMap<S[T], M>>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.type, combineRecordOutputMaps(this.selects, recordmapping), this.wheres, this._historyMode, this._limit);
  }

  where<Field extends WhereFields<S[T]>, Condition extends WhereConditions<S[T], Field>>(field: Field, condition: Condition, value: WhereValueOptions<S[T], Field, Condition>["value"], options?: GetOptionsIfExists<WhereValueOptions<S[T], Field, Condition>, object>): WRDSingleQueryBuilder<S, T, O> {
    return new WRDSingleQueryBuilder(this.type, this.selects, [...this.wheres, { field, condition, value, options }], this._historyMode, this._limit);
  }

  match(obj: MatchObjectQueryable<S[T]>): WRDSingleQueryBuilder<S, T, O> {
    const newwheres = Object.entries(obj).map(([field, value]) => ({ field, condition: "=" as const, value, options: undefined }));
    return new WRDSingleQueryBuilder(this.type, this.selects, [...this.wheres, ...newwheres], this._historyMode, this._limit);
  }

  $call<TO extends RecordOutputMap<S[T]> | null>(cb: (b: WRDSingleQueryBuilder<S, T, O>) => WRDSingleQueryBuilder<S, T, TO>): WRDSingleQueryBuilder<S, T, TO> {
    return cb(this);
  }

  /*** Set the history mode for this query
   * @param mode - History mode
   * - "now": Only show currently visible entities
   * - "all": Show all entities, including past and future - but no temporaries
   * - `{ mode: "now" }`: Only show currently visible entities
   * - `{ mode: "all" }`: Show all entities, including past and future - but no temporaries
   * - `{ mode: "active" }`: Show all entities that are now visible plus any temporaries
   * - `{ mode: "unfiltered" }`: Show all entities (including invisible and temporaries)
   * - `{ mode: "at", when: Date }`: Show all entities that were visible at a specific time
   * - `{ mode: "range", start: Date, limit: Date }`: Show all entities that were visible anywhere in a range of time
   */
  historyMode(mode: SimpleHistoryMode | HistoryModeData): WRDSingleQueryBuilder<S, T, O>;

  /*** Set the history mode for this query to show all entities that were visible at a specific time
   * @param mode - "at": Show all entities that were visible at a specific time
   * @param when - The time at which the entities are/were visible
   */
  historyMode(mode: "at", when: Date): WRDSingleQueryBuilder<S, T, O>;

  /*** Set the history mode for this query to show all entities that were visible anywhere in a range of time
   * @param mode - "range": Show all entities that were visible anywhere in a range of time
   * @param start - Start of the range
   * @param limit - End of the range
   */
  historyMode(mode: "range", start: Date, limit: Date): WRDSingleQueryBuilder<S, T, O>;

  historyMode(mode: SimpleHistoryMode | "at" | "range" | HistoryModeData, start?: Date, limit?: Date): WRDSingleQueryBuilder<S, T, O> {
    if (typeof mode === "object")
      return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, mode, this._limit);
    switch (mode) {
      case "now":
      case "active":
      case "unfiltered":
      case "all": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode }, this._limit);
      }
      case "at": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode, when: start! }, this._limit);
      }
      case "range": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode, start: start!, limit: limit! }, this._limit);
      }
      default:
        throw new Error(`Unknown history mode '${mode}'`);
    }
  }

  limit(limit: number | null): WRDSingleQueryBuilder<S, T, O> {
    if (limit && limit < 0)
      throw new Error(`Illegal negative query result limit`);
    return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, this._historyMode, limit);
  }

  private async executeInternal<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>> {
    if (!this.selects)
      throw new Error(`A select is required`);

    return runSimpleWRDQuery(this.type, this.selects || {}, this.wheres, this._historyMode, this._limit, options) as unknown as Promise<QueryReturnArrayType<S, T, O, Export>>;
  }

  enrich<
    EnrichTypeTag extends keyof S & string,
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    Mapping extends EnrichOutputMap<S[EnrichTypeTag]>,
    RightOuterJoin extends boolean = false,
    DataRow extends QueryReturnRowType<S, T, O, false> & Record<EnrichKey, number | null> = QueryReturnRowType<S, T, O, false> & Record<EnrichKey, number | null>,
  >(type: EnrichTypeTag,
    field: EnrichKey,
    mapping: Mapping,
    options: { rightOuterJoin?: RightOuterJoin } = {}
  ): WRDSingleQueryBuilderWithEnrich<S,
    Awaited<WRDEnrichResult<
      S,
      EnrichTypeTag,
      EnrichKey,
      DataRow,
      Mapping,
      RightOuterJoin>>[number]> {
    return new WRDSingleQueryBuilderWithEnrich(this.type.schema, this, [{ type, field, mapping, options }]);
  }

  execute(options: ExportOptions & { export: true }): Promise<QueryReturnArrayType<S, T, O, true>>;
  execute(options?: ExportOptions & { export?: false | undefined }): Promise<QueryReturnArrayType<S, T, O, false>>;
  execute<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>>;

  execute<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>> {
    return this.executeInternal(options);
  }

  executeRequireExactlyOne(options: ExportOptions & { export: true }): Promise<QueryReturnArrayType<S, T, O, true>[number]>;
  executeRequireExactlyOne(options?: ExportOptions & { export?: false | undefined }): Promise<QueryReturnArrayType<S, T, O, false>[number]>;
  executeRequireExactlyOne<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>[number]>;

  async executeRequireExactlyOne<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>[number]> {
    if (this._limit === null)
      return this.limit(2).executeRequireExactlyOne(options);
    return this.executeInternal(options).then(res => {
      if (res.length !== 1)
        throw new Error(`Expected exactly one result, got ${res.length} when running ${this.describeQuery()}.executeRequireExactlyOne()`);
      return res[0];
    });
  }

  async executeRequireAtMostOne(options: ExportOptions & { export: true }): Promise<QueryReturnArrayType<S, T, O, true>[number] | null>;
  async executeRequireAtMostOne(options?: ExportOptions & { export?: false | undefined }): Promise<QueryReturnArrayType<S, T, O, false>[number] | null>;
  async executeRequireAtMostOne<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>[number] | null>;

  async executeRequireAtMostOne<Export extends boolean>(options?: ExportOptions): Promise<QueryReturnArrayType<S, T, O, Export>[number] | null> {
    if (this._limit === null)
      return this.limit(2).executeRequireAtMostOne() as Promise<QueryReturnArrayType<S, T, O, Export>[number] | null>;
    return this.executeInternal().then(res => {
      if (res.length > 1)
        throw new Error(`Expected at most one result, got ${res.length} when running ${this.describeQuery()}.executeRequireAtMostOne()`);
      return res[0] ?? null;
    });
  }

  async getEventMasks(): Promise<string[]> {
    return this.type.getEventMasks();
  }
}

export class WRDSingleQueryBuilderWithEnrich<S extends SchemaTypeDefinition, O extends object> {
  private schema: WRDSchema<S>;
  private baseQuery: WRDSingleQueryBuilder<S, any, any>;
  private enriches: Array<{
    type: string;
    field: string;
    mapping: any;
    options: any;
  }>;

  constructor(schema: WRDSchema<S>, baseQuery: WRDSingleQueryBuilder<S, any, any>, enriches: Array<{
    type: string;
    field: string;
    mapping: any;
    options: any;
  }>) {
    this.schema = schema;
    this.baseQuery = baseQuery;
    this.enriches = enriches;
  }

  private describeQuery() {
    return `${this.baseQuery["describeQuery"]()}${this.enriches.map(enrich => `.enrich(${JSON.stringify(enrich.type)}, ${JSON.stringify(enrich.field)}, ${JSON.stringify(enrich.mapping)}${enrich.options ? `, ${JSON.stringify(enrich.options)}` : ""})`).join("")}`;
  }

  private async executeInternal(options?: ExportOptions): Promise<O[]> {
    let retval = await this.baseQuery.execute(options) as any;
    for (const enrich of this.enriches)
      retval = await this.schema.enrich(enrich.type, retval, enrich.field as never, enrich.mapping, enrich.options);
    return retval as O[];
  }

  enrich<
    EnrichTypeTag extends keyof S & string,
    EnrichKey extends keyof O & NumberOrNullKeys<O>,
    Mapping extends EnrichOutputMap<S[EnrichTypeTag]>,
    RightOuterJoin extends boolean = false,
  >(type: EnrichTypeTag,
    field: EnrichKey,
    mapping: Mapping,
    options: { rightOuterJoin?: RightOuterJoin } = {}
  ): WRDSingleQueryBuilderWithEnrich<S,
    Awaited<WRDEnrichResult<
      S,
      EnrichTypeTag,
      EnrichKey,
      O,
      Mapping,
      RightOuterJoin>>[number]> {
    return new WRDSingleQueryBuilderWithEnrich(this.schema, this.baseQuery, [...this.enriches, { type, field, mapping, options }]);
  }

  execute(options?: ExportOptions): Promise<O[]> {
    return this.executeInternal(options);
  }

  executeRequireExactlyOne(options?: ExportOptions): Promise<O> {
    return this.executeInternal(options).then(res => {
      if (res.length !== 1)
        throw new Error(`Expected exactly one result, got ${res.length} when running ${this.describeQuery()}.executeRequireExactlyOne()`);
      return res[0];
    });
  }

  executeRequireAtMostOne(options?: ExportOptions): Promise<O | null> {
    return this.executeInternal(options).then(res => {
      if (res.length > 1)
        throw new Error(`Expected at most one result, got ${res.length} when running ${this.describeQuery()}.executeRequireAtMostOne()`);
      return res[0] ?? null;
    });
  }

  async getEventMasks(): Promise<string[]> {
    const masks = await this.baseQuery.getEventMasks();
    for (const maskList of await Promise.all(this.enriches.map(enrich => this.schema.getType(enrich.type).getEventMasks())))
      masks.push(...maskList);
    return [...new Set(masks)].sort();
  }
}
