//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

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
  if (process.env.WEBHARE_DEBUG) {
    for (const flag of process.env.WEBHARE_DEBUG.split(',') ?? [])
      flags[flag] = true;
  } else if (debugsettings) {
    for (const flag of debugsettings.tags)
      flags[flag] = true;
  }
  return flags;
}

export const flags: DebugFlags = getWHDebugFlags() as DebugFlags;

/** Update the debugconfig as present in the system configuration record
    @param settings - debugconfig cell of the system configuration record
*/
export function updateDebugConfig(settings: DebugConfig | null) {
  debugsettings = settings;

  const oldenabledflags = Object.keys(flags).sort().join(",");
  const newflags = getWHDebugFlags();
  const newenabledflags = Object.keys(newflags).sort().join(",");
  if (oldenabledflags !== newenabledflags) {
    Object.assign(flags, newflags);
    for (const key of Object.keys(flags))
      if (!(key in newflags))
        delete flags[key];
    for (const cb of [...settingschangedcallbacks]) {
      // ignore throws here, we can't don anything in this lowlevel code
      try { cb(); } catch (e) { }
    }
  }
}

export function registerDebugConfigChangedCallback(cb: () => void) {
  settingschangedcallbacks.push(cb);
}
