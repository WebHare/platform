//We implement the backend version of getWHDebugFlags so bridge can access us without going through a recursive dep

export function getWHDebugFlags() {
  const flags: { [key: string]: boolean } = {};
  for (const flag of process.env.WEBHARE_DEBUG?.split(',') ?? [])
    flags[flag] = true;
  return flags;
}
