//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

import { DTAPStage } from "./concepts";

/// List global polyfills currently active. This may be needed to align TypeScript hosts configuration
export const globalPolyfills: string[] = [];

/// An object with string keys and typed values
export interface WellKnownFlags {
  /** Log RPcs */
  rpc?: boolean;
  /** Log web traffic */
  wrq?: boolean;
  /** Autoprofile */
  apr?: boolean;
  /** IPC */
  ipc?: boolean;
  /** async */
  async?: boolean;
}
export type DebugFlags = WellKnownFlags & { [key: string]: boolean | undefined };

export type DebugConfig = {
  tags: readonly string[];
  outputsession: string;
  context: string;
};

const settingschangedcallbacks = new Array<() => void>;

/* Global debug flags are set by `wh debug`, local flags are prefilled by environment variables.
   Edits to the debug flags will be applied to the local flags (unless setDebugFlagsOverrideCB returns
   override records).
*/
const globalDebugFlags: DebugFlags = {}, localDebugFlags: DebugFlags = {};

/** Returns the flag override records. The first record is examined first, then the second, etc. */
let debugFlagsOverridesCB: undefined | (() => DebugFlags[]);

/** Override the debug flag override getter. */
export function setDebugFlagsOverrideCB(cb: undefined | (() => DebugFlags[])) {
  debugFlagsOverridesCB = cb;
}

/* Proxy handler for the published debug flags. Uses the override records (with the first record
   examined first, then the second, etc.) to override the flags from baseDebugFlags. Setting to `true` sets
   the flag, `false` disables it and setting to `undefined` has the same effect as deleting the property in the
   current top record (exposing any value from a lower record, like the debug settings from `wh debug`).
*/
class DebugFlagsProxyHandler implements ProxyHandler<DebugFlags> {
  private getRecordList(): DebugFlags[] {
    return [...debugFlagsOverridesCB?.() ?? [], localDebugFlags, globalDebugFlags];
  }

  get(target: DebugFlags, p: string) {
    for (const record of this.getRecordList())
      if (p in record && typeof record[p] !== "undefined")
        return record[p];
    return undefined;
  }
  has(target: DebugFlags, p: string): boolean {
    return this.get(target, p) !== undefined;
  }
  ownKeys(target: DebugFlags): Array<string | symbol> {
    const keys = new Array<string | symbol>;
    for (const record of this.getRecordList())
      for (const key of Reflect.ownKeys(record))
        if (typeof key === "string" && record[key] !== undefined && !keys.includes(key))
          keys.push(key);
    return keys;
  }
  set(target: DebugFlags, p: string, newValue: boolean | undefined): boolean {
    const toModify = this.getRecordList()[0];
    if (typeof newValue === "boolean")
      toModify[p] = newValue;
    else
      delete toModify[p];

    runSettingsCallbacks();
    return true;
  }
  deleteProperty(target: DebugFlags, p: string): boolean {
    const toModify = this.getRecordList()[0];
    delete toModify[p];

    runSettingsCallbacks();
    return true;
  }
  getOwnPropertyDescriptor(target: DebugFlags, p: string): PropertyDescriptor | undefined {
    const value = this.get(target, p);
    return value !== undefined ? { enumerable: true, value, configurable: true } : undefined;
  }
}

export const debugFlags = new Proxy<DebugFlags>({
  [Symbol.for('nodejs.util.inspect.custom')]: formatForConsoleLogs
}, new DebugFlagsProxyHandler());

function formatForConsoleLogs() {
  return `DebugFlags [${[...Object.keys(debugFlags)].filter(key => debugFlags[key]).join(", ")}]`;
}

function runSettingsCallbacks() {
  for (const cb of [...settingschangedcallbacks]) {
    try {
      cb();
    } catch (e) {
      console.error("Error invoking settings change callback", cb?.name, e);
      //ignore, debugFlags can change due to external updates so they're basically signal handlers and there's no real point in crashing whatever was really running
    }
  }
}

/** Update the debugconfig as present in the system configuration record
    @param settings - debugconfig cell of the system configuration record
*/
export function updateDebugConfig(settings: DebugConfig | null) {
  const oldenabledflags = Object.keys(globalDebugFlags).sort();
  const newenabledflags = settings?.tags ? [...settings.tags].sort() : [];

  if (oldenabledflags.join(",") !== newenabledflags.join(",")) {
    for (const flag of newenabledflags)
      globalDebugFlags[flag] = true;
    for (const flag of oldenabledflags)
      if (!newenabledflags.includes(flag))
        delete globalDebugFlags[flag];

    runSettingsCallbacks();
  }
  if (debugFlags.async && Error.stackTraceLimit < 100)
    Error.stackTraceLimit = 100;
}

export function registerDebugConfigChangedCallback(cb: () => void) {
  settingschangedcallbacks.push(cb);
}

/** DTAP stage set for this WebHare */
let dtapStage: DTAPStage = DTAPStage.Production as const;

/** Whether we should (pretend) to be live/production ... true on production and acceptance */
let isLive: boolean = true;

/** The backend base URL. Used for eg. autoconfiguring JSON/RPC */
let backendBase = "";

//deprecated variants
/** @deprecated For WH5.4 and up use 'dtapStage' */
let dtapstage: DTAPStage = dtapStage;
/** @deprecated For WH5.4 and up use 'isLive' */
let islive: boolean = isLive;

export function initEnv(setDtapStage: DTAPStage, setBackendBase: string) {
  dtapStage = setDtapStage;
  isLive = dtapStage === DTAPStage.Production || dtapStage === DTAPStage.Acceptance;
  backendBase = setBackendBase;

  dtapstage = dtapStage;
  islive = isLive;
}

export { dtapStage, isLive, backendBase };
export { dtapstage, islive }; //deprecated variants
