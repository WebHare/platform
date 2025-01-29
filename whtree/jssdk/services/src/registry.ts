import { loadlib } from "@webhare/harescript";
import type { RegistryKeys } from "@mod-platform/generated/registry/registry.ts";
// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "@storage-system/generated/registry/registry.ts";


export async function readRegistryKey<Key extends keyof RegistryKeys>(key: Key, defaultValue?: RegistryKeys[Key]): Promise<RegistryKeys[Key]>;
export async function readRegistryKey<ExpectedType>(key: string, defaultValue?: ExpectedType): Promise<ExpectedType>;

export async function readRegistryKey(key: string, defaultValue?: unknown): Promise<unknown> {
  return (await loadlib("mod::system/lib/configure.whlib").ReadRegistryKey(key, { fallback: defaultValue }));
}

export async function writeRegistryKey<Key extends keyof RegistryKeys>(key: Key, value: RegistryKeys[Key], options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void>;
export async function writeRegistryKey<ValueType, Key extends string = string>(key: Key, value: Key extends keyof RegistryKeys ? RegistryKeys[Key] : ValueType, options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void>;
export async function writeRegistryKey(key: string, value: unknown, options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void> {
  await loadlib("mod::system/lib/configure.whlib").WriteRegistryKey(key, value, options);
}
