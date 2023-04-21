import { HSVMObject } from '@webhare/services/src/hsvm';
import { WRDSchema } from "./schema";
import { WRDEntity, WRDEntitySettings } from "./entity";
import { extendWorkToCoHSVM } from '@webhare/services/src/co-hsvm';

export interface WRDTypeInfo {
  tag: string;
}

export interface WRDFilter {
  field: string;
  value: string | number | boolean | number[];
  matchcase?: boolean;
  matchtype?: "=" | "in";
  filters?: WRDFilter[];
}

export interface WRDQuery {
  outputcolumns: { [key: string]: string } | string[];
  filters?: WRDFilter[];
  resultlimit?: number;
}


function fixFilter(filter: WRDFilter): WRDFilter {
  const clone = { ...filter };
  if (clone.matchtype)
    //@ts-ignore HareScript wants them in uppercase
    clone.matchtype = clone.matchtype.toUpperCase();
  if (clone.filters)
    clone.filters = fixFilters(clone.filters);
  return clone;
}

function fixFilters(filters: WRDFilter[]): WRDFilter[] {
  return filters.map(fixFilter);
}


export class WRDType {
  _wrdschema: WRDSchema;
  _type: WRDTypeInfo;
  typeobj: HSVMObject | null = null;

  constructor(wrdschema: WRDSchema, type: WRDTypeInfo) {
    this._wrdschema = wrdschema;
    this._type = type;
  }

  private async ensureType() {
    if (!this.typeobj)
      this.typeobj = await this._wrdschema.schema.getType(this._type.tag) as HSVMObject;
    return this.typeobj;
  }

  async runQuery(query: WRDQuery): Promise<unknown[]> {
    const typeobj = await this.ensureType();
    if (query.filters)
      query.filters = fixFilters(query.filters);

    const results = await typeobj.runQuery(query) as unknown[];
    return results;
  }

  /** Search for an entity with a specific value in an attribute
      @param tagname - Attribute to search
      @param tagval - Value to search for
      @param options - matchcase Whether case must be matched, defaults to TRUE
      @returns Id of first matching entity, null if not found
  */
  async search(tagname: string, tagval: string | number, options?: { matchCase?: boolean }): Promise<number | null> {
    /* TODO
    @cell options.ignoreallowedvalues Whether to ignore invalid values for enumeration, defaults to FALSE
     @cell options.historymode History mode, defaults to 'now'
       options := ValidateOptions([ matchcase :=           TRUE
                                    , ignoreallowedvalues := FALSE
                                    , historymode :=         "now"
                                    ], options); */

    const results = await this.runQuery({
      filters: [{ field: tagname, value: tagval, matchcase: options?.matchCase || false }],
      outputcolumns: ["wrd_id"],
      resultlimit: 1
    });
    return (results as Array<{ wrd_id: number }>)[0]?.wrd_id ?? null;
  }


  async updateAttribute(tag: string, settings: WRDEntitySettings) {
    const typeobj = await this.ensureType();
    await extendWorkToCoHSVM();
    await typeobj.UpdateAttribute(tag, settings);
    return;
  }

  async createAttribute(tag: string, type: string, settings: WRDEntitySettings) {
    const typeobj = await this.ensureType();
    await extendWorkToCoHSVM();
    await typeobj.CreateAttribute(tag, type, settings);
    return;
  }

  private async buildEntity(hsvm_wrdentity: HSVMObject) {
    const entityid = await hsvm_wrdentity.get("id") as number;
    return new WRDEntity(this, entityid, hsvm_wrdentity);
  }

  async getEntity(id: number) {
    const typeobj = await this.ensureType();
    const hsvm_wrdentity = await typeobj.getEntity(id) as HSVMObject | null;
    if (!hsvm_wrdentity)
      return null; //FIXME or should we throw ?

    return this.buildEntity(hsvm_wrdentity);
  }

  async createEntity(settings: WRDEntitySettings, options = {}) {
    if (!settings)
      throw new Error(`createEntity requires initial entity settings`);

    const typeobj = await this.ensureType();
    await extendWorkToCoHSVM();

    const hsvm_wrdentity = await typeobj.createEntity(settings, options) as HSVMObject;
    return this.buildEntity(hsvm_wrdentity);
  }

  async updateEntity(id: number, updates: unknown) {
    const typeobj = await this.ensureType();
    await extendWorkToCoHSVM();
    await typeobj.updateEntity(id, updates);
  }

  async deleteEntity(id: number) {
    const typeobj = await this.ensureType();
    await extendWorkToCoHSVM();
    await typeobj.deleteEntity(id);
  }
}
