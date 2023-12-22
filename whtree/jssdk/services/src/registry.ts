import { loadlib } from "@webhare/harescript";

export async function readRegistryKey<ExpectedType>(key: string, defaultValue?: ExpectedType): Promise<ExpectedType> {
  return (await loadlib("mod::system/lib/configure.whlib").ReadRegistryKey(key, { fallback: defaultValue })) as ExpectedType;
}

export async function writeRegistryKey<ValueType>(key: string, value: ValueType, options?: { createIfNeeded?: boolean; initialCreate?: boolean }): Promise<void> {
  await loadlib("mod::system/lib/configure.whlib").WriteRegistryKey(key, value, options);
}
