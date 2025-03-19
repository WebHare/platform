import type { GetTidHooks } from "./types.js";

let hookFactory: (() => GetTidHooks) | undefined;
let gotHooks = false;

export function setGetTidHooksFactory(newHookFactory: () => GetTidHooks) {
  if (gotHooks)
    throw new Error(`The call to setGetTidHooksFactory was too late - hooks have already been retrieved once`);
  hookFactory = newHookFactory;
}

export function getGetTidHooks() {
  gotHooks = true;
  return hookFactory?.();
}
