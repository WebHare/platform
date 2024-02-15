/* eslint-disable @typescript-eslint/no-explicit-any -- too much any's needed for generic types */
import { HSVMObject } from "@webhare/services/src/hsvm";
import { AnySchemaTypeDefinition, AllowedFilterConditions, RecordOutputMap, SchemaTypeDefinition, recordizeOutputMap, Insertable, Updatable, CombineSchemas, OutputMap, RecordizeOutputMap, RecordizeEnrichOutputMap, GetCVPairs, MapRecordOutputMap, AttrRef, EnrichOutputMap, CombineRecordOutputMaps, combineRecordOutputMaps, WRDMetaType, WRDAttributeTypeNames, MapEnrichRecordOutputMap, MapEnrichRecordOutputMapWithDefaults, recordizeEnrichOutputMap, WRDAttributeType, WRDGender } from "./types";
export type { SchemaTypeDefinition } from "./types";
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";
import { loadlib } from "@webhare/harescript";
import { checkPromiseErrorsHandled } from "@webhare/js-api-tools";
import { ensureScopedResource } from "@webhare/services/src/codecontexts";
import { fieldsToHS, tagToHS, outputmapToHS, repairResultSet, tagToJS, repairResultValue, WRDAttributeConfiguration, WRDAttributeConfiguration_HS } from "@webhare/wrd/src/wrdsupport";
import { getSchemaData, SchemaData } from "./db";
import { debugFlags } from "@webhare/env";
import { getDefaultJoinRecord, runSimpleWRDQuery } from "./queries";
import { isTruthy, omit } from "@webhare/std";
import { EnrichmentResult, executeEnrichment } from "@mod-system/js/internal/util/algorithms";

const getWRDSchemaType = Symbol("getWRDSchemaType"); //'private' but accessible by friend WRDType

const WRDCloseModes = ["close", "delete", "delete-closereferred", "delete-denyreferred", "close-denyreferred"] as const;
type WRDCloseMode = typeof WRDCloseModes[number];

interface EntityCloseOptions {
  closeMode?: WRDCloseMode;
}
interface WRDTypeConfigurationBase {
  metaType: WRDMetaType;
  title?: string;
  deleteClosedAfter?: number;
  keepHistoryDays?: number;
  hasPersonalData?: boolean;
}

interface WRDObjectTypeConfiguration extends WRDTypeConfigurationBase {
  metaType: WRDMetaType.Object;
}

interface WRDAttachmentTypeConfiguration extends WRDTypeConfigurationBase {
  metaType: WRDMetaType.Attachment;
  left?: string;
}

interface WRDLinkTypeConfiguration extends WRDTypeConfigurationBase {
  metaType: WRDMetaType.Link;
  left?: string;
  right?: string;
}

interface WRDDomainTypeConfiguration extends WRDTypeConfigurationBase {
  metaType: WRDMetaType.Domain;
}

type WRDTypeConfiguration = WRDObjectTypeConfiguration | WRDAttachmentTypeConfiguration | WRDLinkTypeConfiguration | WRDDomainTypeConfiguration;

// Updatable type metadata
type WRDTypeMetadata = Omit<WRDTypeConfiguration, "metaType">;

type WRDAttributeCreateConfiguration = Pick<WRDAttributeConfiguration, 'attributeType'> & Partial<Omit<WRDAttributeConfiguration, 'attributeType'>>;

type CoVMSchemaCache = {
  schemaobj: Promise<HSVMObject>;
  types: Record<string, Promise<HSVMObject>>;
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
  MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>>,
  never,
  true extends RightOuterJoin ? MapEnrichRecordOutputMapWithDefaults<S[T], RecordizeEnrichOutputMap<S[T], Mapping>> : never,
  never>;

function validateCloseMode(closeMode: string) {
  if (!WRDCloseModes.includes(closeMode as WRDCloseMode))
    throw new Error(`Illegal delete mode '${closeMode}' - must be one of: ${WRDCloseModes.join(", ")}`);
}

export class WRDSchema<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  readonly id: number | string;
  coVMSchemaCacheSymbol: symbol;
  schemaData: Promise<SchemaData> | undefined;

  constructor(id: number | string) {
    this.id = id;
    this.coVMSchemaCacheSymbol = Symbol("WHCoVMSchemaCache " + this.id);
  }

  ensureSchemaData(): Promise<SchemaData> {
    return this.schemaData ??= getSchemaData(this.id);
  }

  /*private*/ async __toWRDTypeId(tag: string | undefined): Promise<number> {
    if (!tag)
      return 0;

    const hstag = tagToHS(tag);
    const schemaobj = await this.getWRDSchema();
    const typelist = await schemaobj.ListTypes() as Array<{ id: number; tag: string }>;
    const match = typelist.find(t => t.tag === hstag);
    if (!match)
      throw new Error(`No such type '${tag}' in schema '${this.id}'`);
    return match.id;
  }

  async createType(tag: string, config: WRDTypeConfiguration): Promise<WRDType<S, string>> {
    const hstag = tagToHS(tag);
    const schemaobj = await this.getWRDSchema();
    const left = await this.__toWRDTypeId((config as WRDLinkTypeConfiguration)?.left);
    const right = await this.__toWRDTypeId((config as WRDLinkTypeConfiguration)?.right);

    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();

    const createrequest = {
      title: "",
      description: "",
      tag: hstag,
      requiretype_left: left,
      requiretype_right: right,
      metatype: config.metaType,
      //TODO parenttype, abstract, hasperonaldata defaulting to TRUE for WRD_PERSON (but shouldn't the base schema do that?)
      deleteclosedafter: config.deleteClosedAfter || 0,
      keephistorydays: config.keepHistoryDays || 0,
      haspersonaldata: config.hasPersonalData || false
    };

    await schemaobj.__DoCreateType(createrequest);
    return this.getType(tag);
  }

  async describeType(tag: string) {
    const type = await this[getWRDSchemaType](tag, true);
    if (!type)
      return null;

    const linkfrom = await type.$get("linkfrom") as number;
    const linkto = await type.$get("linkto") as number;

    return {
      left: linkfrom ? await this.__getTypeTag(linkfrom) : null,
      right: linkto ? await this.__getTypeTag(linkto) : null
    };
  }

  getType<T extends keyof S & string>(type: T): WRDType<S, T> {
    return new WRDType<S, T>(this, type);
  }

  async __getTypeTag(type: number): Promise<string | null> {
    const typelist = await this.__listTypes();
    const match = typelist.find(t => t.id === type);
    return match ? tagToJS(match.tag) : null;
  }

  async __listTypes() {
    const schemaobj = await this.getWRDSchema();
    return await schemaobj.ListTypes() as Array<{ id: number; tag: string }>;
  }

  private getWRDSchemaCache(): CoVMSchemaCache {
    return ensureScopedResource(this.coVMSchemaCacheSymbol, (context) => ({
      schemaobj: (async () => {
        //const hsvm = await getCoHSVM();
        const wrd_api = debugFlags["wrd:usewasmvm"]
          ? loadlib("mod::wrd/lib/api.whlib")
          : (await getCoHSVM()).loadlib("mod::wrd/lib/api.whlib");
        const wrdschema = (typeof this.id === "number" ? await wrd_api.OpenWRDSchemaById(this.id) : await wrd_api.OpenWRDSchema(this.id)) as HSVMObject | null;
        if (!wrdschema)
          throw new Error(`No such WRD schema ${this.id}`);
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
    try {
      await this.getWRDSchema();
      return true;
    } catch (e) {
      return false;
    }
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

  // FIXME Deprecate once everyone is at least 5.4.1
  // eslint-disable-next-line @typescript-eslint/ban-types
  selectFrom<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, [], null, null);
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  query<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, [], null, null);
  }

  modify<T extends keyof S & string>(type: T): WRDModificationBuilder<S, T> {
    const wrdtype = this.getType(type);
    return new WRDModificationBuilder(wrdtype, [], null);
  }

  insert<T extends keyof S & string>(type: T, value: Insertable<S[T]>): Promise<number> {
    return checkPromiseErrorsHandled(this.getType(type).createEntity(value));
  }

  update<T extends keyof S & string>(type: T, wrd_id: number, value: Updatable<S[T]>): Promise<void> {
    return checkPromiseErrorsHandled(this.getType(type).updateEntity(wrd_id, value));
  }

  upsert<T extends keyof S & string>(type: T, keys: Array<keyof Insertable<S[T]>>, value: Insertable<S[T]>, options?: { ifNew?: Insertable<S[T]>; historyMode?: SimpleHistoryModes }): Promise<[number, boolean]> {
    return checkPromiseErrorsHandled(this.getType(type).upsert(keys, value, options));
  }

  search<T extends keyof S & string, F extends AttrRef<S[T]>>(type: T, field: F, value: (GetCVPairs<S[T][F]> & { condition: "="; value: unknown })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }, object> & { historyMode: SimpleHistoryModes | HistoryModeData }): Promise<number | null> {
    return checkPromiseErrorsHandled(this.getType(type).search(field, value, options));
  }

  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>> | null> {
    const rows: Array<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>> = await this.selectFrom(type)
      .select(mapping)
      .where("wrdId", "=" as any, id as any)
      .historyMode("__getfields")
      .execute();
    return rows[0] ?? null;
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
      historyMode?: SimpleHistoryModes | HistoryModeData;
    } = {}
  ): WRDEnrichResult<S, T, EnrichKey, DataRow, Mapping, RightOuterJoin> {
    return checkPromiseErrorsHandled(this.getType(type).enrich(data, field, mapping, options));
  }

  close<T extends keyof S & string>(type: T, ids: number | number[], options?: EntityCloseOptions): Promise<void> {
    return checkPromiseErrorsHandled(this.getType(type).close(ids, options));
  }

  delete<T extends keyof S & string>(type: T, ids: number | number[]): Promise<void> {
    return checkPromiseErrorsHandled(this.getType(type).close(ids, { closeMode: "delete" }));
  }

  extendWith<T extends SchemaTypeDefinition>(): WRDSchema<CombineSchemas<S, T>> {
    return this as unknown as WRDSchema<CombineSchemas<S, T>>;
  }
}

export class WRDType<S extends SchemaTypeDefinition, T extends keyof S & string> {
  schema: WRDSchema<S>;
  tag: T;

  private attrs: null | WRDAttributeConfiguration_HS[] = null;
  private attrPromise: null | Promise<WRDAttributeConfiguration_HS[]> = null;

  constructor(schema: WRDSchema<S>, tag: T) {
    this.schema = schema;
    this.tag = tag;
  }

  /** Test whether this type actually exists in the database */
  async exists() {
    return Boolean(await this.schema[getWRDSchemaType](this.tag, true));
  }

  async _getType() {
    return this.schema[getWRDSchemaType](this.tag, false);
  }

  async ensureAttributes() {
    if (!this.attrPromise)
      this.attrPromise = (await this._getType()).listAttributes(0) as Promise<WRDAttributeConfiguration_HS[]>;

    const attrs = await this.attrPromise;
    const genderattr = attrs.find(_ => _.tag === "WRD_GENDER");
    if (genderattr) { //patch for JS
      genderattr.attributetypename = "ENUM";
      genderattr.attributetype = 23;
      genderattr.allowedvalues = Object.values(WRDGender);
    }

    return this.attrs = await this.attrPromise;
  }

  async updateMetadata(newmetadata: Partial<WRDTypeMetadata>) {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    await (await this._getType()).updateMetadata(newmetadata);
  }

  async createEntity(value: Insertable<S[T]>): Promise<number> {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    if (!this.attrs)
      await this.ensureAttributes();

    const entityobj = await (await this._getType()).createEntity(fieldsToHS(value, this.attrs!), { jsmode: true });
    return await (entityobj as HSVMObject).$get("id") as number;
  }

  async updateEntity(wrd_id: number, value: Updatable<S[T]>): Promise<void> {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    if (!this.attrs)
      await this.ensureAttributes();

    await (await this._getType()).updateEntity(wrd_id, fieldsToHS(value, this.attrs!), { jsmode: true });
  }

  async upsert(keys: Array<keyof Insertable<S[T]>>, value: Insertable<S[T]>, options?: { ifNew?: Insertable<S[T]>; historyMode?: SimpleHistoryModes }): Promise<[number, boolean]> {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    if (!this.attrs)
      await this.ensureAttributes();
    if (!keys.length)
      throw new Error(`Upsert requires at least one key field`);
    if ((value as unknown as { wrdLimitDate: Date | null }).wrdLimitDate === null && options?.historyMode !== "all")
      throw new Error(`Resetting wrdLimitDate requires historyMode: all`);

    let lookup = this.schema.selectFrom(this.tag).select(["wrdId"]).historyMode(options?.historyMode ?? "now");
    for (const key of keys) {
      if (!Object.hasOwn(value, key))
        throw new Error(`Upsert requires a value for key field '${key as string}'`);
      lookup = lookup.where(key as string, "=", value[key]);
    }

    const result = await lookup.execute() as Array<{ wrdId: number }>; //TODO not sure why it's not being inferred
    if (result.length > 1)
      throw new Error(`Upsert matched multiple records`);

    if (result.length === 1) {
      await this.updateEntity(result[0].wrdId, value);
      return [result[0].wrdId, false];
    }

    const newId = await this.createEntity({ ...value, ...options?.ifNew });
    return [newId, true];
  }

  async search<F extends AttrRef<S[T]>>(field: F, value: (GetCVPairs<S[T][F]> & { condition: "="; value: unknown })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }, object> & { historyMode?: HistoryModeData | SimpleHistoryModes }): Promise<number | null> {
    const historyMode = toHistoryData(options?.historyMode ?? "now");
    if (debugFlags["wrd:usewasmvm"] && debugFlags["wrd:usejsengine"]) {
      type FilterOverride = { field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown };
      const list = await runSimpleWRDQuery(this, "wrdId", [{ field, condition: "=", value, options } as FilterOverride], historyMode, 1);
      return list.length ? list[0] as number : null;
    }
    const res = await (await this._getType()).search(tagToHS(field), value, { ...(options || {}), ...translateHistoryModeToHS(historyMode), jsmode: true }) as number;
    return res || null;
  }

  private async getBulkFields<Mapping extends EnrichOutputMap<S[T]>, Id extends number | null>(
    enrichMapping: Mapping,
    ids: Id[],
    isLeftOuterJoin: boolean,
    matchCase: boolean, //FIXME unused and thus untested...
    historyMode: HistoryModeData): Promise<Map<Id, MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>>>> {
    const vals = await runSimpleWRDQuery(
      this,
      { __joinId: "wrdId", data: recordizeEnrichOutputMap(enrichMapping) },
      isLeftOuterJoin ? [] : [{ field: "wrdId", condition: "in", value: ids.filter(isTruthy) }],
      historyMode,
      null) as Array<{ __joinId: Id; data: MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>> }>;

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
      historyMode?: SimpleHistoryModes | HistoryModeData;
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
      MapEnrichRecordOutputMapWithDefaults<S[T], RecordizeEnrichOutputMap<S[T], Mapping>>;

    const historyMode = toHistoryData(options.historyMode ?? "now");

    if (debugFlags["wrd:usewasmvm"] && debugFlags["wrd:usejsengine"]) {
      const rightOuterJoin = (options.rightOuterJoin ?
        () => {
          const recordizedOutputMap = recordizeOutputMap(mapping);
          return getDefaultJoinRecord(this, recordizedOutputMap);
        } : null) as (() => RightOuterJoinType) | null;

      const result = executeEnrichment<
        DataRow,
        EnrichKey,
        MapEnrichRecordOutputMap<S[T], RecordizeEnrichOutputMap<S[T], Mapping>>,
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
    //avoid sending the original array through the API (and having to repair it!)
    const outputmap = recordizeOutputMap(mapping);
    const lookupkeys = new Set(data.map(row => row[field]));
    //HS wants an array to look up, so convert the uniquefied keys to {__js_enricon: lookup key }
    const lookuparray = [...lookupkeys.values()].map(key => ({ __js_enrichon: key }));
    const result = await (await this._getType()).enrich(lookuparray, "__js_enrichon", outputmapToHS(outputmap), { ...options, jsmode: true, ...translateHistoryModeToHS(historyMode) }) as Array<{ __js_enrichon?: DataRow[EnrichKey] } & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], Mapping>>>;
    const resultlookup = new Map(result.map(row => [row.__js_enrichon, row]));
    const resultrows: Array<Record<string, unknown>> = [];
    for (const row of data) {
      const enrichment = resultlookup.get(row[field]);
      if (!enrichment) //unmatched
        continue;

      const remergedrow = { ...enrichment, ...row };
      delete remergedrow.__js_enrichon;
      resultrows.push(remergedrow);
    }

    return repairResultSet(resultrows, outputmap) as unknown as RetVal;
  }

  async close(ids: number | number[], options?: EntityCloseOptions): Promise<void> {
    const closeMode = options?.closeMode ?? "close";
    validateCloseMode(closeMode);

    ids = Array.isArray(ids) ? ids : [ids];
    if (!ids.length)
      return;
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();

    const type = await this._getType();

    if (closeMode === 'delete') {
      await type.deleteEntities(ids);
      return;
    }
    if (closeMode === 'close') {
      for (const id of ids)
        await type.closeEntity(id);
      return;
    }

    for (const id of ids) {
      //this is unlikely to be fast, but imports are usually background tasks and we can solve this after TS migrations
      const isreferred = await type.IsReferenced(id);
      switch (closeMode) {
        case "close-denyreferred":
          if (isreferred)
            throw new Error(`Entity ${id} cannot be closed, it is still being referred`);
          await type.closeEntity(id);
          break;
        case "delete-closereferred":
          if (isreferred)
            await type.closeEntity(id);
          else
            await type.deleteEntity(id);
          break;
        case "delete-denyreferred":
          if (isreferred)
            throw new Error(`Entity ${id} cannot be deleted, it is still being referred`);
          await type.deleteEntity(id);
          break;
      }
    }
  }

  async describeAttribute(tag: string): Promise<WRDAttributeConfiguration | null> {
    if (tag === "wrdGender" && this.tag === "wrdPerson")  // HS doesn't fully know wrdGender is an enum in JS
      return {
        tag: "wrdGender",
        attributeType: WRDAttributeType.Enum,
        title: '',
        checkLinks: false,
        domain: null,
        isUnsafeToCopy: false,
        isRequired: false,
        isOrdered: false,
        allowedValues: ['male', 'female', 'other']
      };

    const typeobj = await this._getType();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await typeobj.GetAttribute(tagToHS(tag)) as WRDAttributeConfiguration_HS;
    if (!result)
      return null;

    return {
      tag: result.tag,
      attributeType: result.attributetype,
      title: result.title || "",
      checkLinks: result.checklinks,
      domain: result.domain ? await this.schema.__getTypeTag(result.domain) : null,
      isUnsafeToCopy: result.isunsafetocopy,
      isRequired: result.isrequired,
      isOrdered: result.isordered,
      allowedValues: result.allowedvalues.length ? result.allowedvalues : []
    };
  }

  async createAttribute(tag: string, configuration: WRDAttributeCreateConfiguration) {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    const typeobj = await this._getType();
    const typetag = WRDAttributeTypeNames[configuration.attributeType - 1];

    const configclone: Omit<Partial<WRDAttributeConfiguration>, 'domain'> & { domain?: string | number | null } = configuration;
    delete configclone.attributeType;

    if (configuration.domain)
      configclone.domain = await this.schema.__toWRDTypeId(configuration.domain);

    await typeobj.CreateAttribute(tagToHS(tag), typetag, configclone);
    return;
  }

  async updateAttribute(tag: string, configuration: Partial<WRDAttributeConfiguration>) {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    const typeobj = await this._getType();
    await typeobj.UpdateAttribute(tagToHS(tag), configuration);
    return;
  }

  async getEventMasks(): Promise<string[]> {
    const type = await this._getType();
    return (await type.GetEventMasks() as string[]).sort();
  }
}

export type SimpleHistoryModes = "now" | "all";
export type HistoryModeData = { mode: "now" | "all" | "__getfields" } | { mode: "at"; when: Date } | { mode: "range"; when_start: Date; when_limit: Date } | null;
type GetOptionsIfExists<T, D> = T extends { options: unknown } ? T["options"] : D;
type HSWRDQuery = {
  outputcolumn?: string;
  outputcolumns?: object;
  filters?: object[];
  historyMode?: "now" | "all" | "__getfields" | "at" | "range";
  when?: Date;
  when_start?: Date;
  when_limit?: Date;
  jsmode: true;
  resultlimit?: number;
};

type QueryReturnArrayType<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> = O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never;
type QueryReturnRowType<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> = O extends RecordOutputMap<S[T]> ? MapRecordOutputMap<S[T], O> : never;

function toHistoryData(mode: SimpleHistoryModes | HistoryModeData): HistoryModeData {
  return typeof mode === "string" ? { mode } : mode;
}

function translateHistoryModeToHS(mode: HistoryModeData) {
  return mode ? { historyMode: mode.mode, ...omit(mode, ["mode"]) } : null;
}

export class WRDQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string> {
  protected type: WRDType<S, T>;
  protected wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>;
  protected _historyMode: HistoryModeData;

  constructor(type: WRDType<S, T>, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>, historyMode: HistoryModeData) {
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

  where<F extends keyof S[T] & string, Condition extends GetCVPairs<S[T][F]>["condition"] & AllowedFilterConditions>(field: F, condition: Condition, value: (GetCVPairs<S[T][F]> & { condition: Condition })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: Condition }, undefined>): WRDModificationBuilder<S, T> {
    // Need to cast the filter because the options member isn't accepted otherwise
    type FilterOverride = { field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown };
    return new WRDModificationBuilder<S, T>(this.type, [...this.wheres, { field, condition, value, options } as FilterOverride], this._historyMode);
  }

  $call(cb: (b: WRDModificationBuilder<S, T>) => WRDModificationBuilder<S, T>): WRDModificationBuilder<S, T> {
    return cb(this);
  }

  historyMode(mode: "now" | "all" | "__getfields"): WRDModificationBuilder<S, T>;
  historyMode(mode: "at", when: Date): WRDModificationBuilder<S, T>;
  historyMode(mode: "range", start: Date, limit: Date): WRDModificationBuilder<S, T>;

  historyMode(mode: "now" | "all" | "__getfields" | "at" | "range", start?: Date, limit?: Date): WRDModificationBuilder<S, T> {
    switch (mode) {
      case "now":
      case "__getfields":
      case "all": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode });
      }
      case "at": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode, when: start! });
      }
      case "range": {
        return new WRDModificationBuilder(this.type, this.wheres, { mode, when_start: start!, when_limit: limit! });
      }
    }
  }

  async sync<F extends AttrRef<S[T]>>(joinAttribute: F, inrows: Array<Insertable<S[T]>>, options?: EntityCloseOptions) {
    const retval = {
      created: [] as number[],
      updated: [] as number[],
      missing: [] as number[],
      matched: [] as number[]
    };

    if (options?.closeMode)
      validateCloseMode(options.closeMode);

    //sample first row to get desired 'current' cells
    const currentCells = Object.keys(inrows[0] || {}).filter(_ => _ !== joinAttribute);
    //I don't think we can get tree-like structures from selectFrom (yet?) - original ImportEntities puts all data in a 'current' cell. So we'll just query them as current_0, ..
    const selectCurrentCells = currentCells.map((key, idx) => [`current_${idx}`, key]);
    const outputColumns = {
      wrdId: "wrdId",
      wrdLimitDate: "wrdLimitDate",
      joinField: joinAttribute,
      ...Object.fromEntries(selectCurrentCells)
    };

    //TODO we should filter on joinField too or make this a two stage select. we don't need the currentcells for entities we won't be updating
    const currentRows = await this.__select(outputColumns).execute();
    const now = new Date();

    //@ts-ignore -- yes it doest exist!
    const currentRowMap = new Map(currentRows.map(row => [row.joinField, row]));
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

        for (const [mappedToName, originalName] of selectCurrentCells) {
          if (currentRow[mappedToName] !== inrow[originalName])
            changes[originalName] = inrow[originalName];
        }

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
    const unreferenced = [...currentRowMap.values()].filter(_ => _.wrdLimitDate === null).map(_ => _.wrdId);
    retval.missing = unreferenced;
    if (retval.missing.length && options?.closeMode)
      await this.type.close(retval.missing, options);

    return retval;
  }


}

/* The query object. We are initially created by selectFrom() with an O === null - select() then recreates us with a set O
*/
export class WRDSingleQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> extends WRDQueryBuilder<S, T> {
  private selects: O;
  private _limit: number | null;

  constructor(type: WRDType<S, T>, selects: O, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>, historyMode: HistoryModeData, limit: number | null) {
    super(type, wheres, historyMode);
    this.selects = selects;
    this._limit = limit;
  }

  select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, CombineRecordOutputMaps<S[T], O, RecordizeOutputMap<S[T], M>>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.type, combineRecordOutputMaps(this.selects, recordmapping), this.wheres, this._historyMode, this._limit);
  }

  where<F extends keyof S[T] & string, Condition extends GetCVPairs<S[T][F]>["condition"] & AllowedFilterConditions>(field: F, condition: Condition, value: (GetCVPairs<S[T][F]> & { condition: Condition })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: Condition }, undefined>): WRDSingleQueryBuilder<S, T, O> {
    // Need to cast the filter because the options member isn't accepted otherwise
    type FilterOverride = { field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown };
    return new WRDSingleQueryBuilder(this.type, this.selects, [...this.wheres, { field, condition, value, options } as FilterOverride], this._historyMode, this._limit);
  }

  $call<TO extends RecordOutputMap<S[T]> | null>(cb: (b: WRDSingleQueryBuilder<S, T, O>) => WRDSingleQueryBuilder<S, T, TO>): WRDSingleQueryBuilder<S, T, TO> {
    return cb(this);
  }

  historyMode(mode: "now" | "all" | "__getfields"): WRDSingleQueryBuilder<S, T, O>;
  historyMode(mode: "at", when: Date): WRDSingleQueryBuilder<S, T, O>;
  historyMode(mode: "range", start: Date, limit: Date): WRDSingleQueryBuilder<S, T, O>;

  historyMode(mode: "now" | "all" | "__getfields" | "at" | "range", start?: Date, limit?: Date): WRDSingleQueryBuilder<S, T, O> {
    switch (mode) {
      case "now":
      case "__getfields":
      case "all": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode }, this._limit);
      }
      case "at": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode, when: start! }, this._limit);
      }
      case "range": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { mode, when_start: start!, when_limit: limit! }, this._limit);
      }
    }
  }

  limit(limit: number | null): WRDSingleQueryBuilder<S, T, O> {
    if (limit && limit < 0)
      throw new Error(`Illegal negative query result limit`);
    return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, this._historyMode, limit);
  }

  private async executeInternal(): Promise<QueryReturnArrayType<S, T, O>> {
    if (!this.selects)
      throw new Error(`A select is required`);

    if (debugFlags["wrd:usewasmvm"] && debugFlags["wrd:usejsengine"])
      return runSimpleWRDQuery(this.type, this.selects || {}, this.wheres, this._historyMode, this._limit) as unknown as Promise<QueryReturnArrayType<S, T, O>>;

    const type = await this.type._getType();
    const query: HSWRDQuery = { jsmode: true, ...translateHistoryModeToHS(this._historyMode) };
    if (typeof this.selects === "string")
      query.outputcolumn = tagToHS(this.selects);
    else
      query.outputcolumns = outputmapToHS(this.selects);
    if (this.wheres.length)
      query.filters = this.wheres.map(({ field, condition, value }) => ({ field: tagToHS(field), matchtype: condition.toUpperCase(), value }));
    if (this._limit !== null)
      query.resultlimit = this._limit;
    const result = await type.runQuery(query) as unknown as QueryReturnArrayType<S, T, O>;

    if (typeof this.selects === "string") //no need for translation
      return result.map(repairResultValue) as typeof result;

    return repairResultSet(result as Array<Record<string, unknown>>, this.selects!) as unknown as ReturnType<typeof this.executeInternal>;
  }

  enrich<
    EnrichTypeTag extends keyof S & string,
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    Mapping extends EnrichOutputMap<S[EnrichTypeTag]>,
    RightOuterJoin extends boolean = false,
    DataRow extends QueryReturnRowType<S, T, O> & Record<EnrichKey, number | null> = QueryReturnRowType<S, T, O> & Record<EnrichKey, number | null>,
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

  execute(): Promise<QueryReturnArrayType<S, T, O>> {
    return checkPromiseErrorsHandled(this.executeInternal());
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

  private async executeInternal(): Promise<O[]> {
    let retval = await this.baseQuery.execute() as any;
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

  execute(): Promise<O[]> {
    return checkPromiseErrorsHandled(this.executeInternal());
  }

  async getEventMasks(): Promise<string[]> {
    const masks = await this.baseQuery.getEventMasks();
    for (const maskList of await Promise.all(this.enriches.map(enrich => this.schema.getType(enrich.type).getEventMasks())))
      masks.push(...maskList);
    return [...new Set(masks)].sort();
  }
}
