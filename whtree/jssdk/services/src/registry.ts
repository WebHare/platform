import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { stdTypeOf, throwError } from "@webhare/std";
import { db } from "@webhare/whdb";
import * as crypto from "node:crypto";
import { readAnyFromDatabase } from "@webhare/whdb/src/formats";

import type { RegistryKeys } from "@mod-platform/generated/ts/registry.ts";
// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "wh:ts/registry.ts";

type KeyErrorForValueType<A> = [A] extends [never] ? { error: "Require type parameter!" } : string;

export function splitRegistryKey(key: string, { acceptInvalidKeyNames = false } = {}) {
  let useregexp;
  if (acceptInvalidKeyNames) {
    // ........ (optional user prefix                   ) (module)(sep )(node) (subkey    )
    useregexp = /^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([^:.]+)([:.])(.+\.)?([^.]+)$/;
  } else {

    if (key.startsWith("<anonymous>.")) //why were we even bothering the registry with this?
      throw new Error(`Invalid registry key name '${key}' - <anonymous> keys should be handled in the future TolliumAnonymousUser object`);
    if (key.startsWith("system.modules.") || key.startsWith("modules.")) //although it's doubtful anyone ever did in TS...
      throw new Error(`Invalid registry key name '${key}' - you should no longer prefix registry keys with 'system.modules.' or 'modules.'`);

    /* This will be the recommended module-style format but also a chance to become stricter...
      We want '(<userprefix>.)module:key.name
      ([a-z0-9][-a-z0-9_]*[a-z0-9]) is the module name regex (we have to permit things like '4tu' - for now)
      TODO also prevent double dots in the regex, incorrect trailing dots etc
  */
    // ........ (optional user prefix                   ) (module name                )(sep )(node         ) (subkey    )
    useregexp = /^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([a-z0-9][-a-z0-9_]*[a-z0-9])([:.])([a-z0-9_.]+\.)?([a-z0-9_]+)$/;
  }

  const { 1: userprefix, 2: module, 3: sep, 4: node, 5: subkey } = key.match(useregexp) || throwError(`Invalid registry key name '${key}'`);
  const storenodebase = `${userprefix || ''}${module}.${node || ''}`;
  return {
    userprefix: userprefix || "",
    module,
    sep,
    subnode: node || "",
    subkey,
    storenode: storenodebase
  };
}

function getNameHash({ storenode, subkey }: { storenode: string; subkey: string }) {
  const contenthasher = crypto.createHash('sha1');
  contenthasher.update(storenode + subkey);
  return contenthasher.digest();

}

async function __getRegistryKey(confkey: string, loadkey: boolean, acceptInvalidKeyNames: boolean) {
  const split = splitRegistryKey(confkey, { acceptInvalidKeyNames });
  const hash = getNameHash(split);
  //TODO have the database setup a hash index and deal with this for us. but also we may need a non-startup-blocking reindex then (how big is a registry in practice?)

  const curkey = await db<PlatformDB>().selectFrom("system.flatregistry").selectAll().where("namehash", "=", hash).execute();
  const result = {
    id: curkey[0]?.id || null,
    // eventname: `system:registry.${node}`,
    name: confkey,
    nodehash: hash,
    value: undefined as unknown
  };

  if (curkey.length && loadkey)
    result.value = await readAnyFromDatabase(curkey[0].data, curkey[0].blobdata);

  return result;
}


/** read a registry key
    acceptInvalidKeyNames - set to accept invalid key names that HareScript used to accept. this option may be removed in the future so consider migrating all keys requiring this flag! */
export async function readRegistryKey<Key extends keyof RegistryKeys>(key: Key, defaultValue?: RegistryKeys[Key], opts?: { acceptInvalidKeyNames: boolean }): Promise<RegistryKeys[Key]>;
export async function readRegistryKey<ExpectedType = never>(key: string & KeyErrorForValueType<ExpectedType>, defaultValue?: ExpectedType, opts?: { acceptInvalidKeyNames: boolean }): Promise<ExpectedType>;

export async function readRegistryKey(key: string, defaultValue?: unknown, opts?: { acceptInvalidKeyNames: boolean }): Promise<unknown> {
  // return (await loadlib("mod::system/lib/configure.whlib").ReadRegistryKey(key, { fallback: defaultValue: }));
  if (key[0] === '<' && defaultValue === undefined)
    throw new Error(`Reading a user registry requires you to set a fallback value`); // as you can't initialize it

  //TODO cachettl option
  const keyinfo = await __getRegistryKey(key, true, opts?.acceptInvalidKeyNames || false);
  if (keyinfo.id) {
    if (defaultValue !== undefined) {
      const defaultType = stdTypeOf(defaultValue);
      const keyType = stdTypeOf(keyinfo.value);
      if (defaultType !== keyType) //FIXME needs more smarts for Money/Date etc types
        throw new Error(`Invalid type in registry for registry key '${key}', got ${keyType} but expected ${defaultType}`);
    }
    return keyinfo.value;
  }

  if (defaultValue !== undefined)
    return defaultValue;

  throw new Error(`No such registry key '${key}' - you may need to 'wh apply registry'`);
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
  return [
    ...new Set(keys.map(key => {
      const { storenode } = splitRegistryKey(key);
      return `system:registry.${storenode.substring(0, storenode.length - 1)}`;
    }))
  ].toSorted();
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
