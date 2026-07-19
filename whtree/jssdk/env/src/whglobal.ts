/* Manages the $wh global, an API for just-in-time debugging */
import type { DebugRegistry } from "@webhare/env";
import { debugFlags } from "./envbackend";

let debugRegFinalizer: FinalizationRegistry<{ type: keyof DebugRegistry; key: string }> | undefined;

export type WHGlobal = DebugRegistry & {
  debugFlags: typeof debugFlags;
  /** Global counter to avoid HMRs from duplicating IDs */
  nextId: number;
};

declare global {
  var $wh: WHGlobal;
}

globalThis.$wh = {
  debugFlags,
  nextId: 1
} satisfies WHGlobal;

export function addToDebugRegistry<T extends keyof DebugRegistry>(type: T, key: string, value: NonNullable<ReturnType<NonNullable<DebugRegistry[T]>[string]["deref"]>>) {
  const debugRegistry = globalThis.$wh as unknown as DebugRegistry;
  //@ts-ignore prevents '>   Type '{}' is not assignable to type 'never'. in jssdk builds, probably because noone yet extends DebugRegistry there
  debugRegistry[type] ||= {};
  debugRegFinalizer ||= new FinalizationRegistry(({ type: t, key: k }) => {
    delete debugRegistry![t]?.[k];
  });

  if (debugRegistry[type][key])
    console.error(`Debug registry key ${key} already exists, overwriting it`);

  (debugRegistry[type] as Record<string, unknown>)[key] = new WeakRef(value);
  debugRegFinalizer.register(value, { type, key });
}
