import { HSVMObject } from "@webhare/services/src/hsvm";
import { AllowedFilterConditions, RecordOutputMap, SchemaTypeDefinition, TypeDefinition, recordizeOutputMap, isAttrRef, isAttrRecordMap, Insertable, Updatable, CombineSchemas, OutputMap, RecordizeOutputMap, GetCVPairs, MapRecordOutputMap, AttrRef, EnrichOutputMap } from "./types";
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";

type CombineRecords<T extends TypeDefinition, B extends { [K: string]: RecordOutputMap<T> }, U extends { [K: string]: RecordOutputMap<T> }> = {
  [K in (keyof B | keyof U) & string]:
  K extends keyof U
  ? (K extends keyof B
    ? CombineOutputMap<T, B[K], U[K]>
    : U[K])
  : B[K]
};

export type CombineOutputMap<T extends TypeDefinition, B extends RecordOutputMap<T> | null, U extends RecordOutputMap<T>> =
  B extends { [K: string]: RecordOutputMap<T> }
  ? (U extends { [K: string]: RecordOutputMap<T> }
    ? CombineRecords<T, B, U>
    : U)
  : U;

export function combineOutputMap<T extends TypeDefinition, B extends RecordOutputMap<T> | null, U extends RecordOutputMap<T>>(b: B, u: U): CombineOutputMap<T, B, U> {
  if (b && !isAttrRef(b) && !isAttrRef(u)) {
    if (typeof b === "object" && typeof u === "object") {
      const res = { ...b } as CombineOutputMap<T, B, U> & object;
      for (const entry of Object.entries(u)) {
        const prop_base = res[entry[0]];
        const prop_update = entry[1];

        if (!prop_base)
          res[entry[0]] = prop_update;
        else if (isAttrRecordMap(prop_base) && isAttrRecordMap(prop_update))
          res[entry[0]] = combineOutputMap(prop_base, prop_update);
        else
          throw new Error(`Cannot combine selects, trying to combine a record with a field or vv`);
      }
      return res;
    }
  }
  return u as CombineOutputMap<T, B, U>;
}

export class WRDSchema<S extends SchemaTypeDefinition> {
  #id: number | string;
  #types: { [K in keyof S & string]?: WRDType<S, K> } = {};
  #wrdschema: HSVMObject | undefined;

  constructor(id: number | string) {
    this.#id = id;
  }

  #getType<T extends keyof S & string>(type: T): WRDType<S, T> {
    let retval = this.#types[type];
    if (!retval) {
      retval = new WRDType<S, T>(this, type, () => this.#getWRDSchema());
      this.#types[type] = retval;
    }
    return retval;
  }

  async #getWRDSchema(): Promise<HSVMObject> {
    if (!this.#wrdschema) {
      const hsvm = await getCoHSVM();
      const wrd_api = hsvm.loadlib("mod::wrd/lib/api.whlib");
      const wrdschema = (typeof this.#id === "number" ? await wrd_api.OpenWRDSchemaById(this.#id) : await wrd_api.OpenWRDSchema(this.#id)) as HSVMObject | null;
      if (!wrdschema)
        throw new Error(`No such WRD schema ${this.#id}`);
      this.#wrdschema = wrdschema;
    }
    return this.#wrdschema;
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  selectFrom<T extends keyof S & string>(type: T): WRDSingleQueryBuilder<S, T, null> {
    const wrdtype = this.#getType(type);
    return new WRDSingleQueryBuilder(wrdtype, null, []);
  }

  insert<T extends keyof S & string>(type: T, value: Insertable<S[T]>) {
    return this.#getType(type).createEntity(value);
  }

  update<T extends keyof S & string>(type: T, wrd_id: number, value: Updatable<S[T]>) {
    return this.#getType(type).updateEntity(wrd_id, value);
  }

  search<T extends keyof S & string, F extends AttrRef<S[T]>>(type: T, field: F, value: (GetCVPairs<S[T][F]> & { condition: "=" })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }>): Promise<number | null> {
    return this.#getType(type).search(field, value, options);
  }

  enrich<T extends keyof S & string, F extends keyof D, M extends EnrichOutputMap<S[T]>, D extends { [K in F]: number }>(type: T, data: D[], field: F, mapping: M): Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>> {
    return this.#getType(type).enrich(data, field, mapping);
  }

  extendWith<T extends SchemaTypeDefinition>(): WRDSchema<CombineSchemas<S, T>> {
    return this as unknown as WRDSchema<CombineSchemas<S, T>>;
  }
}


export class WRDType<S extends SchemaTypeDefinition, T extends keyof S & string> {
  schema: WRDSchema<S>;
  tag: T;
  _getSchemaObj: () => Promise<HSVMObject>;
  _schemaobj: HSVMObject | undefined;
  _type: HSVMObject | undefined;

  constructor(schema: WRDSchema<S>, tag: T, getSchemaObj: () => Promise<HSVMObject>) {
    this.schema = schema;
    this.tag = tag;
    this._getSchemaObj = getSchemaObj;
  }

  async _getType() {
    if (!this._type) {
      if (!this._schemaobj) {
        this._schemaobj = await this._getSchemaObj();
      }
      this._type = await this._schemaobj.getType(this.tag) as HSVMObject;
      if (!this._type)
        throw new Error(`No such type ${JSON.stringify(this.tag)}`);
    }
    return this._type;
  }

  async createEntity(value: Updatable<S[T]>): Promise<number> {
    await extendWorkToCoHSVM();
    const entityobj = await (await this._getType()).createEntity(value);
    return await (entityobj as HSVMObject).get("id") as number;
  }

  async updateEntity(wrd_id: number, value: Updatable<S[T]>): Promise<void> {
    await extendWorkToCoHSVM();
    await (await this._getType()).updateEntity(wrd_id, value);
  }

  async search<F extends AttrRef<S[T]>>(field: F, value: (GetCVPairs<S[T][F]> & { condition: "=" })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: "=" }>): Promise<number | null> {
    const res = await (await this._getType()).search(field, value, options || {}) as number;
    return res || null;
  }

  async enrich<F extends keyof D, M extends EnrichOutputMap<S[T]>, D extends { [K in F]: number }>(data: D[], field: F, mapping: M): Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>> {
    return (await this._getType()).enrich(data, field, mapping) as Promise<Array<D & MapRecordOutputMap<S[T], RecordizeOutputMap<S[T], M>>>>;
  }

  async runQuery(query: object): Promise<unknown[]> {
    return (await (await this._getType()).runQuery(query)) as unknown[];
  }
}

type GetOptionsIfExists<T> = T extends { options: unknown } ? T["options"] : undefined;
type HSWRDQuery = {
  outputcolumn?: string;
  outputcolumns?: object;
  filters?: object[];
};

export class WRDSingleQueryBuilder<S extends SchemaTypeDefinition, T extends keyof S & string, O extends RecordOutputMap<S[T]> | null> {
  #type: WRDType<S, T>;
  #selects: O;
  #wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>;

  constructor(type: WRDType<S, T>, selects: O, wheres: Array<{ field: keyof S[T] & string; condition: AllowedFilterConditions; value: unknown }>) {
    this.#type = type;
    this.#selects = selects;
    this.#wheres = wheres;
  }

  select<M extends OutputMap<S[T]>>(mapping: M): WRDSingleQueryBuilder<S, T, CombineOutputMap<S[T], O, RecordizeOutputMap<S[T], M>>> {
    const recordmapping = recordizeOutputMap<S[T], typeof mapping>(mapping);
    return new WRDSingleQueryBuilder(this.#type, combineOutputMap(this.#selects, recordmapping), this.#wheres);
  }

  where<F extends keyof S[T] & string, Condition extends GetCVPairs<S[T][F]>["condition"]>(field: F, condition: Condition, value: (GetCVPairs<S[T][F]> & { condition: Condition })["value"], options?: GetOptionsIfExists<GetCVPairs<S[T][F]> & { condition: Condition }>): WRDSingleQueryBuilder<S, T, O> {
    return new WRDSingleQueryBuilder(this.#type, this.#selects, [...this.#wheres, { field, condition, value }]);
  }

  async execute(): Promise<O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never> {
    if (!this.#selects)
      throw new Error(`A select is required`);
    const type = await this.#type._getType();
    const query: HSWRDQuery = {};
    if (typeof this.#selects === "string")
      query.outputcolumn = this.#selects;
    else
      query.outputcolumns = this.#selects;
    if (this.#wheres.length)
      query.filters = this.#wheres.map(({ field, condition, value }) => ({ field, matchtype: condition.toUpperCase(), value }));
    const retval = await type.runQuery(query);
    return retval as unknown as (O extends RecordOutputMap<S[T]> ? Array<MapRecordOutputMap<S[T], O>> : never);
  }
}
