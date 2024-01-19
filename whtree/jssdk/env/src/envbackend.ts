//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

import { DTAPStage } from "./concepts";
import { getEnvironmentDebugFlags } from "./envstartup";

/// An object with string keys and typed values
export interface WellKnownFlags {
  /** Log RPcs */
  rpc?: true;
  /** Log web traffic */
  wrq?: true;
  /** Autoprofile */
  apr?: true;
  /** IPC */
  ipc?: true;
  /** async */
  async?: true;
}
export type DebugFlags = WellKnownFlags & { [key: string]: true | undefined };

export type DebugConfig = {
  tags: string[];
  outputsession: string;
  context: string;
};

let debugsettings: DebugConfig | null;
const settingschangedcallbacks = new Array<() => void>;

function getWHDebugFlags(): DebugFlags {
  const flags: DebugFlags = {};
  const envflags = getEnvironmentDebugFlags();

  for (const flag of envflags)
    flags[flag] = true;
  if (debugsettings) {
    for (const flag of debugsettings.tags)
      flags[flag] = true;
  }
  return flags;
}

const baseDebugFlags = getWHDebugFlags();

/** Returns the flag override records. The first record is examined first, then the second, etc. */
let debugFlagsOverridesCB: undefined | (() => DebugFlags[]);

/** Override the debug flag override getter. */
export function setDebugFlagsOverrideCB(cb: undefined | (() => DebugFlags[])) {
  debugFlagsOverridesCB = cb;
}

/* Proxy handler for the published debug flags. Uses the override records (with the first record
   examined first, then the second, etc.) to override the flags from baseDebugFlags. Only supports
   'true' as property value, setting to value to false has the same effect as deleting the property
   (and will have no effect if the property is set in a later override or the base flags.)
*/
class DebugFlagsProxyHandler implements ProxyHandler<DebugFlags> {
  get(target: DebugFlags, p: string) {
    return this.has(target, p) || undefined;
  }
  has(target: DebugFlags, p: string): boolean {
    const overrides = debugFlagsOverridesCB?.();
    if (overrides) {
      for (const record of overrides)
        if (p in record && record[p])
          return true;
    }
    return Boolean(p in baseDebugFlags && baseDebugFlags[p]);
  }
  ownKeys(target: DebugFlags): Array<string | symbol> {
    const keys = new Array<string | symbol>;
    for (const record of [...debugFlagsOverridesCB?.() ?? [], baseDebugFlags])
      for (const key of Reflect.ownKeys(record))
        if (typeof key === "string" && record[key])
          keys.push(key);
    return keys;
  }
  set(target: DebugFlags, p: string, newValue: true | undefined): boolean {
    const toModify = (debugFlagsOverridesCB?.() ?? [])[0] ?? baseDebugFlags;
    if (newValue)
      toModify[p] = true;
    else
      delete toModify[p];
    return true;
  }
  deleteProperty(target: DebugFlags, p: string): boolean {
    const toModify = (debugFlagsOverridesCB?.() ?? [])[0] ?? baseDebugFlags;
    delete toModify[p];
    return true;
  }
  getOwnPropertyDescriptor(target: DebugFlags, p: string): PropertyDescriptor | undefined {
    return this.has(target, p) ? { enumerable: true, value: true, configurable: true } : undefined;
  }
}

export const debugFlags = new Proxy<DebugFlags>({
  [Symbol.for('nodejs.util.inspect.custom')]: formatForConsoleLogs
}, new DebugFlagsProxyHandler());

function formatForConsoleLogs() {
  return `DebugFlags [${[...Object.keys(debugFlags)]}]`;
}

/** Update the debugconfig as present in the system configuration record
    @param settings - debugconfig cell of the system configuration record
*/
export function updateDebugConfig(settings: DebugConfig | null) {
  debugsettings = settings;

  const oldenabledflags = Object.keys(baseDebugFlags).sort().join(",");
  const newflags = getWHDebugFlags();
  const newenabledflags = Object.keys(newflags).sort().join(",");
  if (oldenabledflags !== newenabledflags) {
    Object.assign(baseDebugFlags, newflags);
    for (const key of Object.keys(baseDebugFlags))
      if (!(key in newflags))
        delete baseDebugFlags[key];
    for (const cb of [...settingschangedcallbacks]) {
      // ignore throws here, we can't don anything in this lowlevel code
      try { cb(); } catch (e) { }
    }
  }
  if (baseDebugFlags.async && Error.stackTraceLimit < 100)
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
  isLive = dtapStage == DTAPStage.Production || dtapStage == DTAPStage.Acceptance;
  backendBase = setBackendBase;

  dtapstage = dtapStage;
  islive = isLive;
}

export { dtapStage, isLive, backendBase };
export { dtapstage, islive }; //deprecated variants
