

export const map: Record<string, number> = {};

let counter = 0;

export function register(mod: NodeModule) {
  const parts = mod.id.split("/");
  map[parts[parts.length - 1]] = ++counter;
}
