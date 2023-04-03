import { HSVMObject } from '@webhare/services/src/hsvm';
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";

export interface WRDEntitySettings {
  [key: string]: number | number[] | boolean | string | string[] | Date | WRDEntitySettings | WRDEntitySettings[] | null;
}

export interface WRDFilter {
  field: string;
  value: string | number;
  matchcase?: boolean;
}

export interface WRDQuery {
  outputcolumns: { [key: string]: string } | string[];
  filters?: WRDFilter[];
  resultlimit?: number;
}

/* TODO If you could do it all over again, what would you do ?

   WRD API:

   onze ^ (hat) bestaat niet echt in JS. het lijkt me niet wijs om het te willen repliceren.

   hoe zou de WRD API er uit moeten zien ?

   1 idee: een subobject types in de wrdschema. en daarin de wrdtypes

   - moeten we *alle* getattributeinfo ook meesturen in de describe call, of moet getattributeinfo een await-able iets worden?

   await wrdschema.types.wrd_person.runQuery(
    { outputcolumns: { n: "WRD_LASTNAME" }
    , filters: [{ field: "CONTACT_EMAIL", value: "test123@example.com", matchcase: false }]
    }));

   - moeten we globale WRDSchema runquery behouden of zeggen "joh, performance gaan we toch niet bijzonder veel beter krijgen, doe maar liever Enrich en neem expliciet de aansturing ter hand"
*/

class WRDEntity {
  _wrdtype: WRDType;
  _entity: HSVMObject;
  readonly id: number;

  constructor(wrdtype: WRDType, id: number, hsvm_wrdentity: HSVMObject) {
    this._wrdtype = wrdtype;
    this._entity = hsvm_wrdentity;
    this.id = id;
  }

  async updateEntity(updates: unknown) { //TODO we could just be named 'update' - it's not reserved in JS ...
    return this._wrdtype.updateEntity(this.id, updates);
  }
}

interface WRDTypeInfo {
  tag: string;
}
class WRDType {
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

interface WRDSchemaInfo {
  id: number;
  tag: string;
  types: WRDTypeInfo[];
}

export class WRDSchema {
  schema: HSVMObject;
  private info: WRDSchemaInfo;
  types: { [key: string]: WRDType };

  constructor(schema: HSVMObject, schemainfo: WRDSchemaInfo) {
    this.schema = schema;
    this.info = schemainfo;
    this.types = {};

    schemainfo.types.forEach(type => this.types[type.tag] = new WRDType(this, type));
  }

  get tag() {
    return this.info.tag;
  }
}

export async function openSchema(name: string) {
  const vm = await getCoHSVM();

  const wrdschema = await vm.loadlib("mod::wrd/lib/api.whlib").openWRDSchema(name) as HSVMObject | null;
  if (!wrdschema)
    return null; //FIXME only if some allowUnknown flag is given like eg WHFS openFile now does

  return new WRDSchema(wrdschema, await wrdschema.__ExplainMyselfToJavascript() as WRDSchemaInfo);
}
