//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

import { getEnvironmentDebugFlags } from "./envstartup";

/// An object with string keys and typed values
interface WellKnownFlags {
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
type DebugFlags = WellKnownFlags & { [key: string]: true | undefined };

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

export const debugFlags: DebugFlags = getWHDebugFlags() as DebugFlags;

/** Update the debugconfig as present in the system configuration record
    @param settings - debugconfig cell of the system configuration record
*/
export function updateDebugConfig(settings: DebugConfig | null) {
  debugsettings = settings;

  const oldenabledflags = Object.keys(debugFlags).sort().join(",");
  const newflags = getWHDebugFlags();
  const newenabledflags = Object.keys(newflags).sort().join(",");
  if (oldenabledflags !== newenabledflags) {
    Object.assign(debugFlags, newflags);
    for (const key of Object.keys(debugFlags))
      if (!(key in newflags))
        delete debugFlags[key];
    for (const cb of [...settingschangedcallbacks]) {
      // ignore throws here, we can't don anything in this lowlevel code
      try { cb(); } catch (e) { }
    }
  }
  if (debugFlags.async && Error.stackTraceLimit < 100)
    Error.stackTraceLimit = 100;
}

export function registerDebugConfigChangedCallback(cb: () => void) {
  settingschangedcallbacks.push(cb);
}
