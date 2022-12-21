import * as envsupport from "./envsupport";

/// An object with string keys and typed values
interface WellKnownFlags {
  /** Log RPcs */
  rpc: boolean;
  /** Autoprofile */
  apr: boolean;
}
type DebugFlags = WellKnownFlags & { [key: string]: boolean };

export const flags: DebugFlags = envsupport.getWHDebugFlags() as DebugFlags;

/** Get the default base URL for RPCs
    @returns In the browser this returns the current root, in the backend it returns primary WebHare url. Always ends with a slash */
export function getDefaultRPCBase() {
  return envsupport.getDefaultRPCBase();
}
