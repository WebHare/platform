import { HSVMObject } from '@webhare/services/src/hsvm';
import type { WRDType } from "./type";

export interface WRDEntitySettings {
  [key: string]: number | number[] | boolean | string | string[] | Date | WRDEntitySettings | WRDEntitySettings[] | null;
}

export class WRDEntity {
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
