/* TODO Move consilio pxl here eventually, but limit how much we actually want to export */
import { sendPxlEvent, type PxlEventData, type PxlOptions } from "@mod-consilio/js/pxl";
import { dtapStage } from "@webhare/env";
import type { FormAnalyticsEvent } from "@webhare/forms";
import type { PxlDataTypes } from "@webhare/frontend";
export { setPxlOptions, getPxlId as getPxlUserId, getPxlSessionId } from "@mod-consilio/js/pxl";

export type PxlData = Record<string, string | number | boolean>;

// Track listener installation. Especially needed during the transition from @mod-publisher/js/forms to @webhare/frontend. After the transition we might not need stack traces anymore
const activeListenPrefixes = new Map<string, Error>;

// Combine with `string & {}` to prevent TypeScript from eliminating `keyof PxlDataTypes`
type AllowedKeys = keyof PxlDataTypes | (string & {});

// Filters out invalid types from the PXL data type
type FilterValidTypes<T extends object | void> = T extends object ? {
  [K in keyof T]: T[K] extends undefined | string | number | boolean ?
  T[K] :
  { __error: "Invalid property type used in PXL event declaration, allowed: boolean, number, string"; __type: T[K] };
} : T;

/// Helper type to allow making the data parameter optional when the datatype is void
type ParamTuples<DataType, Key extends AllowedKeys> = Key extends keyof PxlDataTypes ?
  [data: FilterValidTypes<PxlDataTypes[Key]>, options?: Partial<PxlOptions>] :
  (DataType extends void ?
    [data?: void, options?: Partial<PxlOptions>] :
    [data: DataType, options?: Partial<PxlOptions>]);

// Error type for when an event is not declared in PxlDataTypes and no data type override is provided
type NeedTypeParamError = { __error: "Event not declared in PxlDataTypes and no data type override provided" } & symbol;

export function sendPxl<DataType extends (Event extends keyof PxlDataTypes ? NeedTypeParamError : void | PxlData | NeedTypeParamError) = NeedTypeParamError, Event extends AllowedKeys = AllowedKeys>(eventKey: Event, ...params: ParamTuples<NoInfer<DataType>, Event>): void {
  const [data, options] = params;
  const pxldata: PxlEventData = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === undefined)
      continue;
    if (typeof v === "string")
      pxldata[`ds_${k}`] = v;
    else if (typeof v === "number")
      pxldata[`dn_${k}`] = v;
    else if (typeof v === "boolean")
      pxldata[`db_${k}`] = v;
    else
      throw new Error(`Invalid type '${typeof v}' for PXL data key '${k}'`);
  }

  sendPxlEvent(eventKey, pxldata, options);
}

/** Setup pxl events for form analytics events
 * @param options - Options for the form analytics setup
     - `eventPrefix`. Prefix to use. Default is `platform:form_` but existing integrations may (also) require `publisher:form`
*/
export function setupFormAnalytics(options?: { eventPrefix: string }): void {
  const prefix = options?.eventPrefix || "platform:form_";
  const registered = activeListenPrefixes.get(prefix);
  if (registered)
    if (dtapStage !== "production")
      return console.error(`Duplicate setupFormAnalytics for prefix '${prefix}', earlier registration: `, registered);

  activeListenPrefixes.set(prefix, new Error); //getStackTrace() would have been nicer, but doesn't get sourcemapped in the console

  addEventListener("wh:form-analytics", (e: FormAnalyticsEvent) => {
    const formeventdata: { [K in `formmeta_${string}`]: string | number | boolean } = {};
    for (const [key, val] of Object.entries(e.detail))
      if (key !== "event" && ["string", "number", "boolean"].includes(typeof val))
        formeventdata[`formmeta_${key}`] = val;

    sendPxl<PxlData>(`${prefix}${e.detail.event}`, formeventdata, e.detail.event === "abandoned" ? { beacon: true } : undefined);
  });
}
