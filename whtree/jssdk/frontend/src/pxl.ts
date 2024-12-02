/* TODO Move consilio pxl here eventually, but limit how much we actually want to export */
import { sendPxlEvent, type PxlEventData, type PxlOptions } from "@mod-consilio/js/pxl";
import type { PxlDataTypes } from "@webhare/frontend";
export { setPxlOptions, getPxlId as getPxlUserId, getPxlSessionId } from "@mod-consilio/js/pxl";

export type PxlData = Record<string, string | number | boolean>;

export function sendPxl<EventType extends keyof PxlDataTypes>(dataobject: EventType, data: PxlDataTypes[EventType] & PxlData, options?: Partial<PxlOptions>): void;
//we use a second parameter to break inferring the first parameter, so we can properly detect it missing
export function sendPxl<DataType = void, _DataType extends DataType = DataType>(dataobject: string, data: _DataType, options?: Partial<PxlOptions>): void;

export function sendPxl<DataType extends PxlData = never>(dataobject: string, data: DataType, options?: Partial<PxlOptions>): void {
  const pxldata: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string")
      pxldata[`ds_${k}`] = v;
    else if (typeof v === "number")
      pxldata[`dn_${k}`] = v;
    else if (typeof v === "boolean")
      pxldata[`db_${k}`] = v;
    else
      throw new Error(`Invalid type '${typeof v}' for PXL data key '${k}'`);
  }

  sendPxlEvent(dataobject, pxldata as PxlEventData, options);
}
