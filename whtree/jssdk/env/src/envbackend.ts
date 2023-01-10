//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

export type DebugConfig = {
  tags: string[];
  outputsession: string;
  context: string;
};

let debugsettings: DebugConfig | null;

/** Update the debugconfig as present in the system configuration record
    @param settings - debugconfig cell of the system configuration record
*/
export function updateDebugConfig(settings: DebugConfig | null) {
  debugsettings = settings;
}

export function getWHDebugFlags() {
  const flags: { [key: string]: boolean } = {};
  if (process.env.WEBHARE_DEBUG) {
    for (const flag of process.env.WEBHARE_DEBUG.split(',') ?? [])
      flags[flag] = true;
  } else if (debugsettings) {
    for (const flag of debugsettings.tags)
      flags[flag] = true;
  }
  return flags;
}
