import { callHareScript } from "./services";

export async function readRegistryKey<ExpectedType>(key: string, defaultValue?: ExpectedType): Promise<ExpectedType> {
  const args: unknown[] = [key];
  if (defaultValue !== undefined)
    args.push({ fallback: defaultValue });

  return callHareScript("mod::system/lib/configure.whlib#ReadRegistryKey", args, { openPrimary: true }) as ExpectedType;
}
