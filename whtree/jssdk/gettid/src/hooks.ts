import type { GetTidHooks } from "./types.js";

let hookFactory: (() => GetTidHooks) | undefined;
let gotHooks = false;

export function setGetTidHooksFactory(newHookFactory: () => GetTidHooks) {
  if (gotHooks)
    throw new Error(`Hooks have already been retrieved`);
  hookFactory = newHookFactory;
}

export function getGetTidHooks() {
  if (gotHooks)
    throw new Error(`Hooks cannot be retrieved twice`);
  gotHooks = true;
  return hookFactory?.();
}
