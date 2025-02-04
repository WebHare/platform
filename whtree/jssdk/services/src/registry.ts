import { loadlib } from "@webhare/harescript";
import type { RegistryKeys } from "@mod-platform/generated/registry/registry.ts";
// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "@storage-system/generated/registry/registry.ts";

function splitRegistryKey(key: string): [string, string] {
  const split = key.match(/^(.+)[:.]([^:.]+)$/);
  if (!split || !split[1] || !split[2])
    throw new Error(`Invalid registry key name '${key}'`);
  const parts = split.slice(1) as [string, string];
  return [parts[0].replace(":", ".") as string, parts[1]];
}

type KeyErrorForValueType<A> = [A] extends [never] ? { error: "Require type parameter!" } : string;


export async function readRegistryKey<Key extends keyof RegistryKeys>(key: Key, defaultValue?: RegistryKeys[Key]): Promise<RegistryKeys[Key]>;
export async function readRegistryKey<ExpectedType = never>(key: string & KeyErrorForValueType<ExpectedType>, defaultValue?: ExpectedType): Promise<ExpectedType>;

export async function readRegistryKey(key: string, defaultValue?: unknown): Promise<unknown> {
  return (await loadlib("mod::system/lib/configure.whlib").ReadRegistryKey(key, { fallback: defaultValue }));
}

export async function writeRegistryKey<Key extends keyof RegistryKeys>(key: Key, value: RegistryKeys[Key], options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void>;
export async function writeRegistryKey<ValueType, Key extends string = string>(key: Key, value: Key extends keyof RegistryKeys ? RegistryKeys[Key] : ValueType, options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void>;

export async function writeRegistryKey(key: string, value: unknown, options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void> {
  await loadlib("mod::system/lib/configure.whlib").WriteRegistryKey(key, value, options);
}

/** Read registry keys by mask. not a public API yet in TS - it seems only to be used by maintenance of shortcuts so maybe we can get rid of it as an API ? it also differs quite a bit from readRegistryNode (and we could just give that one mask support if we want it...)
    @param keymask - Mask to use (to search the temporary anonymous registry, the mask must look like an anonymous key ie start with <anonymous>.)
    @returns Registry keys
*/
export async function readRegistryKeysByMask(keymask: string): Promise<Array<{ name: string; value: unknown }>> {
  return loadlib("mod::system/lib/configure.whlib").ReadRegistryKeysByMask(keymask);
}

/** Get the event masks to use to listen to specific registry keys
    @param keys - List of registry keys
    @returns A list of event mask(s) */
export function getRegistryKeyEventMasks(keys: string[]): string[] {
  return [...new Set(keys.map(key => `system:registry.${splitRegistryKey(key)[0]}`))].toSorted();
}

/** Get all keys in a node
    @param confkey - Registry node name
    @returns List of registry keys
*/
export async function readRegistryNode(confkey: string): Promise<Array<{ fullname: string; subkey: string; data: unknown }>> {
  return loadlib("mod::system/lib/configure.whlib").ReadRegistryNode(confkey);
}

/** Deletes a registry key.
    @param confkey - Key to delete
*/
export async function deleteRegistryKey(confkey: string): Promise<void> {
  return await loadlib("mod::system/lib/configure.whlib").DeleteRegistryKey(confkey);
}

/** Deletes a registry node
    @param confkey - Node to delete
*/
export async function deleteRegistryNode(confkey: string): Promise<void> {
  return await loadlib("mod::system/lib/configure.whlib").DeleteRegistryNode(confkey);
}
