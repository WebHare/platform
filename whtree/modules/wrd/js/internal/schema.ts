import { HSVMObject } from "@webhare/services/src/hsvm";
import { AnySchemaTypeDefinition, AllowedFilterConditions, RecordOutputMap, SchemaTypeDefinition, recordizeOutputMap, Insertable, Updatable, CombineSchemas, OutputMap, RecordizeOutputMap, GetCVPairs, MapRecordOutputMap, AttrRef, EnrichOutputMap, CombineRecordOutputMaps, combineRecordOutputMaps, WRDMetaType } from "./types";
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";
import { checkPromiseErrorsHandled } from "@mod-system/js/internal/util/devhelpers";
import { ensureScopedResource } from "@webhare/services/src/codecontexts";

interface WRDEntitySettings { //TODO this will go away as soon as createAttribute/updateAttribute are redefined
  [key: string]: number | number[] | boolean | string | string[] | Date | WRDEntitySettings | WRDEntitySettings[] | null;
}

interface WRDTypeConfigurationBase {
  metatype: WRDMetaType;
  title?: string;
  description?: string;
  keephistorydays?: number;
  haspersonaldata?: boolean;
}

interface WRDObjectTypeConfiguration extends WRDTypeConfigurationBase {
  metatype: WRDMetaType.Object;
}

interface WRDAttachmentTypeConfiguration extends WRDTypeConfigurationBase {
  metatype: WRDMetaType.Attachment;
  left?: string;
}

interface WRDLinkTypeConfiguration extends WRDTypeConfigurationBase {
  metatype: WRDMetaType.Link;
  left?: string;
  right?: string;
}

interface WRDDomainTypeConfiguration extends WRDTypeConfigurationBase {
  metatype: WRDMetaType.Domain;
}

type WRDTypeConfiguration = WRDObjectTypeConfiguration | WRDAttachmentTypeConfiguration | WRDLinkTypeConfiguration | WRDDomainTypeConfiguration;

type CoVMSchemaCache = {
  schemaobj: Promise<HSVMObject>;
  types: Record<string, Promise<HSVMObject>>;
};

export class WRDSchema<S extends SchemaTypeDefinition = AnySchemaTypeDefinition> {
  private id: number | string;
  coVMSchemaCacheSymbol: symbol;

  constructor(id: number | string) {
    this.id = id;
    this.coVMSchemaCacheSymbol = Symbol("WHCoVMSchemaCache " + this.id);
  }

  private async toWRDTypeId(tag: string | undefined): Promise<number> {
    if (!tag)
      return 0;

    const schemaobj = await this.getWRDSchema();
    const typelist = await schemaobj.ListTypes() as Array<{ id: number; tag: string }>;
    const match = typelist.find(t => t.tag === tag);
    if (!match)
      throw new Error(`No such type '${tag}' in schema '${this.id}'`);
    return match.id;
  }

  async createType(tag: string, config: WRDTypeConfiguration): Promise<WRDType<S, string>> {
    const schemaobj = await this.getWRDSchema();
    const left = await this.toWRDTypeId((config as WRDLinkTypeConfiguration)?.left);
    const right = await this.toWRDTypeId((config as WRDLinkTypeConfiguration)?.right);

    await extendWorkToCoHSVM();

    const createrequest = {
      title: "",
      description: "",
      tag,
      requiretype_left: left,
      requiretype_right: right,
      metatype: config.metatype,
      //TODO parenttype, abstract, hasperonaldata defaulting to TRUE for WRD_PERSON (but shouldn't the base schema do that?)
      keephistorydays: config.keephistorydays || 0,
      haspersonaldata: config.haspersonaldata || false
    };

    await schemaobj.__DoCreateType(createrequest);
    return this.getType(tag);
  }

  getType<T extends keyof S & string>(type: T): WRDType<S, T> {
    return new WRDType<S, T>(this, type, () => this.getWRDSchemaType(type));
  }

  private getWRDSchemaCache(): CoVMSchemaCache {
    return ensureScopedResource(this.coVMSchemaCacheSymbol, (context) => ({
      schemaobj: (async () => {
        const hsvm = await getCoHSVM();
        const wrd_api = hsvm.loadlib("mod::wrd/lib/api.whlib");
        const wrdschema = (typeof this.id === "number" ? await wrd_api.OpenWRDSchemaById(this.id) : await wrd_api.OpenWRDSchema(this.id)) as HSVMObject | null;
        if (!wrdschema)
          throw new Error(`No such WRD schema ${this.id}`);
        return wrdschema;
      })(),
      types: {}
    }));
  }

  private async getWRDSchema(): Promise< HSVMObject > {
    return this.getWRDSchemaCache().schemaobj;
  }

  private async getWRDSchemaType(type: string): Promise<HSVMObject> {
    const cache: CoVMSchemaCache = this.getWRDSchemaCache();
    if (!cache.types[type]) {
      cache.types[type] = (await cache.schemaobj).getType(type) as Promise<HSVMObject>;
    }
    const typeobj = await cache.types[type];
    if (!typeobj)
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

  async getFields<M extends OutputMap<S[T]>, T extends keyof S & string>(type: T, id: number, mapping: M) {
    const rows = await this.selectFrom(type).select(mapping).where("WRD_ID", "=", id).historyMode("__getfields").execute();
    return rows[0] || null;
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
  _getWRDSchemaTypeObj: (typetag: string) => Promise<HSVMObject>;

  constructor(schema: WRDSchema<S>, tag: T, getWRDSchemaTypeObj: () => Promise<HSVMObject>) {
    this.schema = schema;
    this.tag = tag;
    this._getWRDSchemaTypeObj = getWRDSchemaTypeObj;
  }

  async _getType() {
    return this._getWRDSchemaTypeObj(this.tag);
  }

  async createEntity(value: Updatable<S[T]>): Promise<number> {
    await extendWorkToCoHSVM();
    const entityobj = await (await this._getType()).createEntity(value, { jsmode: true });
    return await (entityobj as HSVMObject).get("id") as number;
  }

  async updateEntity(wrd_id: number, value: Updatable<S[T]>): Promise<void> {
    await extendWorkToCoHSVM();
    await (await this._getType()).updateEntity(wrd_id, value, { jsmode: true });
  }

  async search<F extends AttrRef<S[T]>>(field: F, value: (GetCVPairs<S[T][F]> & { condition: "=" })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }>): Promise<number | null> {
    const res = await (await this._getType()).search(field, value, { ...(options || {}), jsmode: true }) as number;
    return res || null;
  }

  async enrich<F extends keyof D, M extends EnrichOutputMap<S[T]>, D extends { [K in F]: number | null }>(data: D[], field: F, mapping: M, options: { rightouterjoin?: boolean } = {}): Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>> {
    return (await this._getType()).enrich(data, field, recordizeOutputMap(mapping), { ...options, jsmode: true }) as Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>>;
  }

  async delete(ids: number | number[]): Promise<void> {
    ids = Array.isArray(ids) ? ids : [ids];
    if (ids.length) {
      await extendWorkToCoHSVM();
      await (await this._getType()).deleteEntities(ids);
    }
  }

  async createAttribute(tag: string, type: string, settings: WRDEntitySettings = {}) {
    await extendWorkToCoHSVM();
    const typeobj = await this._getType();
    await typeobj.CreateAttribute(tag, type, settings);
    return;
  }

  async updateAttribute(tag: string, settings: WRDEntitySettings) {
    await extendWorkToCoHSVM();
    const typeobj = await this._getType();
    await typeobj.UpdateAttribute(tag, settings);
    return;
  }
}
type HistoryModeData = { historymode: "now" | "all" | "__getfields" } | { historymode: "at"; when: Date } | { historymode: "range"; when_start: Date; when_limit: Date } | null;
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

export class WRDSingleQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> {
  #type: WRDType<S, T>;
  #selects: O;
  #wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>;
  #historymode: HistoryModeData;

  constructor(type: WRDType<S, T>, selects: O, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>, historymode: HistoryModeData) {
    this.#type = type;
    this.#selects = selects;
    this.#wheres = wheres;
    this.#historymode = historymode;
  }

  select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, CombineRecordOutputMaps<S[T], O, RecordizeOutputMap<S[T], M>>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.#type, combineRecordOutputMaps(this.#selects, recordmapping), this.#wheres, this.#historymode);
  }

  where<F extends keyof S[T] & string, Condition extends GetCVPairs<S[T][F]>["condition"] & AllowedFilterConditions>(field: F, condition: Condition, value: (GetCVPairs<S[T][F]> & { condition: Condition })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: Condition }>): WRDSingleQueryBuilder<S, T, O> {
    return new WRDSingleQueryBuilder(this.#type, this.#selects, [...this.#wheres, { field, condition, value }], this.#historymode);
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
        return new WRDSingleQueryBuilder(this.#type, this.#selects, this.#wheres, { historymode: mode });
      }
      case "at": {
        return new WRDSingleQueryBuilder(this.#type, this.#selects, this.#wheres, { historymode: mode, when: start! });
      }
      case "range": {
        return new WRDSingleQueryBuilder(this.#type, this.#selects, this.#wheres, { historymode: mode, when_start: start!, when_limit: limit! });
      }
    }
  }

  async #executeInternal(): Promise<O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never> {
    if (!this.#selects)
      throw new Error(`A select is required`);
    const type = await this.#type._getType();
    let query: HSWRDQuery = { jsmode: true };
    if (typeof this.#selects === "string")
      query.outputcolumn = this.#selects;
    else
      query.outputcolumns = this.#selects;
    if (this.#historymode)
      query = { ...query, ...this.#historymode };
    if (this.#wheres.length)
      query.filters = this.#wheres.map(({ field, condition, value }) => ({ field, matchtype: condition.toUpperCase(), value }));
    const retval = await type.runQuery(query);
    return retval as unknown as (O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never);
  }

  execute(): Promise<O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never> {
    return checkPromiseErrorsHandled(this.#executeInternal());
  }
}
