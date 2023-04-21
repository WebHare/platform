import { HSVMObject } from '@webhare/services/src/hsvm';
import { getCoHSVM } from "@webhare/services/src/co-hsvm";
import { WRDTypeInfo, WRDType } from "./type";

interface WRDSchemaInfo {
  id: number;
  tag: string;
  types: WRDTypeInfo[];
}

class WRDSchema {
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

export type { WRDSchema };
