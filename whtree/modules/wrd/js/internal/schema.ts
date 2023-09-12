import { HSVMObject } from "@webhare/services/src/hsvm";
import { AnySchemaTypeDefinition, AllowedFilterConditions, RecordOutputMap, SchemaTypeDefinition, recordizeOutputMap, Insertable, Updatable, CombineSchemas, OutputMap, RecordizeOutputMap, GetCVPairs, MapRecordOutputMap, AttrRef, EnrichOutputMap, CombineRecordOutputMaps, combineRecordOutputMaps, WRDMetaType, WRDAttributeTypeNames } from "./types";
export { SchemaTypeDefinition } from "./types";
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";
import { loadlib } from "@webhare/harescript";
import { checkPromiseErrorsHandled } from "@webhare/js-api-tools";
import { ensureScopedResource } from "@webhare/services/src/codecontexts";
import { fieldsToHS, tagToHS, outputmapToHS, repairResultSet, tagToJS, repairResultValue, WRDAttributeConfiguration, WRDAttributeConfiguration_HS } from "@webhare/wrd/src/wrdsupport";
import { getSchemaData, SchemaData } from "./db";
import { debugFlags } from "@webhare/env";
import { runSimpleWRDQuery } from "./queries";

const getWRDSchemaType = Symbol("getWRDSchemaType"); //'private' but accessible by friend WRDType

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

  // eslint-disable-next-line @typescript-eslint/ban-types
  selectFrom<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, [], null);
  }

  insert<T extends keyof S & string>(type: T, value: Insertable<S[T]>) {
    return checkPromiseErrorsHandled(this.getType(type).createEntity(value));
  }

  update<T extends keyof S & string>(type: T, wrd_id: number, value: Updatable<S[T]>) {
    return checkPromiseErrorsHandled(this.getType(type).updateEntity(wrd_id, value));
  }

  search<T extends keyof S & string, F extends AttrRef<S[T]>>(type: T, field: F, value: (GetCVPairs<S[T][F]> & { condition: "=" })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }>): Promise<number | null> {
    return checkPromiseErrorsHandled(this.getType(type).search(field, value, options));
  }

  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M): Promise<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>> | null> {
    const rows: Array<MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>> = await this.selectFrom(type).select(mapping).where("wrdId", "=", id).historyMode("__getfields").execute();
    return rows[0] ?? null;
  }

  enrich<T extends keyof S & string, F extends keyof D, M extends EnrichOutputMap<S[T]>, D extends { [K in F]: number | null }>(type: T, data: D[], field: F, mapping: M, options: { rightouterjoin?: boolean } = {}): Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>> {
    return checkPromiseErrorsHandled(this.getType(type).enrich(data, field, mapping, options));
  }

  delete<T extends keyof S & string>(type: T, ids: number | number[]): Promise<void> {
    return checkPromiseErrorsHandled(this.getType(type).delete(ids));
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

    return this.attrs = await this.attrPromise;
  }

  async updateMetadata(newmetadata: Partial<WRDTypeMetadata>) {
    if (!debugFlags["wrd:usewasmvm"])
      await extendWorkToCoHSVM();
    await (await this._getType()).updateMetadata(newmetadata);
  }

  async createEntity(value: Updatable<S[T]>): Promise<number> {
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

  async search<F extends AttrRef<S[T]>>(field: F, value: (GetCVPairs<S[T][F]> & { condition: "=" })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }>): Promise<number | null> {
    const res = await (await this._getType()).search(tagToHS(field), value, { ...(options || {}), jsmode: true }) as number;
    return res || null;
  }

  async enrich<EnrichKey extends keyof DataRow, M extends EnrichOutputMap<S[T]>, DataRow extends { [K in EnrichKey]: number | null }>(data: DataRow[], field: EnrichKey, mapping: M, options: { rightouterjoin?: boolean } = {}): Promise<Array<DataRow & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>> {
    //avoid sending the original array through the API (and having to repair it!)
    const outputmap = recordizeOutputMap(mapping);
    const lookupkeys = new Set(data.map(row => row[field]));
    //HS wants an array to look up, so convert the uniquefied keys to {__js_enricon: lookup key }
    const lookuparray = [...lookupkeys.values()].map(key => ({ __js_enrichon: key }));
    const result = await (await this._getType()).enrich(lookuparray, "__js_enrichon", outputmapToHS(outputmap), { ...options, jsmode: true }) as Array<{ __js_enrichon?: DataRow[EnrichKey] } & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>;
    const resultlookup = new Map(result.map(row => [row.__js_enrichon, row]));
    const resultrows: Array<Record<string, unknown>> = [];
    for (const row of data) {
      const remergedrow = { ...resultlookup.get(row[field]), ...row };
      delete remergedrow.__js_enrichon;
      resultrows.push(remergedrow);
    }

    return repairResultSet(resultrows, outputmap) as unknown as ReturnType<typeof this.enrich<EnrichKey, M, DataRow>>;
  }

  async delete(ids: number | number[]): Promise<void> {
    ids = Array.isArray(ids) ? ids : [ids];
    if (ids.length) {
      if (!debugFlags["wrd:usewasmvm"])
        await extendWorkToCoHSVM();
      await (await this._getType()).deleteEntities(ids);
    }
  }

  async describeAttribute(tag: string): Promise<WRDAttributeConfiguration | null> {
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
}

export type HistoryModeData = { historymode: "now" | "all" | "__getfields" } | { historymode: "at"; when: Date } | { historymode: "range"; when_start: Date; when_limit: Date } | null;
type GetOptionsIfExists<T> = T extends { options: unknown } ? T["options"] : undefined;
type HSWRDQuery = {
  outputcolumn?: string;
  outputcolumns?: object;
  filters?: object[];
  historymode?: "now" | "all" | "__getfields" | "at" | "range";
  when?: Date;
  when_start?: Date;
  when_limit?: Date;
  jsmode: true;
};

/* The query object. We are initially created by selectFrom() with an O === null - select() then recreates us with a set O
*/
export class WRDSingleQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> {
  private type: WRDType<S, T>;
  private selects: O;
  private wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>;
  private historymode: HistoryModeData;

  constructor(type: WRDType<S, T>, selects: O, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>, historymode: HistoryModeData) {
    this.type = type;
    this.selects = selects;
    this.wheres = wheres;
    this.historymode = historymode;
  }

  select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, CombineRecordOutputMaps<S[T], O, RecordizeOutputMap<S[T], M>>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.type, combineRecordOutputMaps(this.selects, recordmapping), this.wheres, this.historymode);
  }

  where<F extends keyof S[T] & string, Condition extends GetCVPairs<S[T][F]>["condition"] & AllowedFilterConditions>(field: F, condition: Condition, value: (GetCVPairs<S[T][F]> & { condition: Condition })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: Condition }>): WRDSingleQueryBuilder<S, T, O> {
    return new WRDSingleQueryBuilder(this.type, this.selects, [...this.wheres, { field, condition, value }], this.historymode);
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
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { historymode: mode });
      }
      case "at": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { historymode: mode, when: start! });
      }
      case "range": {
        return new WRDSingleQueryBuilder(this.type, this.selects, this.wheres, { historymode: mode, when_start: start!, when_limit: limit! });
      }
    }
  }

  private async executeInternal(): Promise<O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never> {
    if (!this.selects)
      throw new Error(`A select is required`);
    const type = await this.type._getType();
    let query: HSWRDQuery = { jsmode: true };
    if (typeof this.selects === "string")
      query.outputcolumn = tagToHS(this.selects);
    else
      query.outputcolumns = outputmapToHS(this.selects);
    if (this.historymode)
      query = { ...query, ...this.historymode };
    if (this.wheres.length)
      query.filters = this.wheres.map(({ field, condition, value }) => ({ field: tagToHS(field), matchtype: condition.toUpperCase(), value }));
    const retval = await type.runQuery(query);
    return retval as unknown as (O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never);
  }

  async execute(): Promise<O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never> {
    if (debugFlags["wrd:usewasmvm"] && debugFlags["wrd:usejsengine"])
      return runSimpleWRDQuery(this.type, this.selects || {}, this.wheres, this.historymode) as unknown as O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never;
    const result = await checkPromiseErrorsHandled(this.executeInternal());
    if (typeof this.selects === "string") //no need for translation
      return result.map(repairResultValue) as typeof result;

    return repairResultSet(result as Array<Record<string, unknown>>, this.selects!) as unknown as ReturnType<typeof this.executeInternal>;
  }
}
