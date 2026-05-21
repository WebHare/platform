/* Manages the $wh global, an API for just-in-time debugging */
import type { DebugRegistry } from "@webhare/env";
import { debugFlags } from "./envbackend";

let debugRegFinalizer: FinalizationRegistry<{ type: keyof DebugRegistry; key: string }> | undefined;

//TODO also expose DebugRegistry but this is tricky typewise
export type WHGlobal = /*DebugRegistry & */ {
  debugFlags: typeof debugFlags;
};

declare global {
  var $wh: WHGlobal;
}

globalThis.$wh = {
  debugFlags
} satisfies WHGlobal;

export function addToDebugRegistry<T extends keyof DebugRegistry>(type: T, key: string, value: NonNullable<ReturnType<DebugRegistry[T][string]["deref"]>>) {
  const debugRegistry = globalThis.$wh as unknown as DebugRegistry;
  debugRegistry[type] ||= {};
  debugRegFinalizer ||= new FinalizationRegistry(({ type: t, key: k }) => {
    delete debugRegistry![t][k];
  });

  if (debugRegistry[type][key])
    console.error(`Debug registry key ${key} already exists, overwriting it`);

  (debugRegistry[type] as Record<string, unknown>)[key] = new WeakRef(value);
  debugRegFinalizer.register(value, { type, key });
}
