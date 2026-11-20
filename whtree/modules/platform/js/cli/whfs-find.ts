/* Support for `wh whfs find-instances` */

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import type { ExportOptions } from "@webhare/services/src/descriptor";
import { db, runInWork, sql } from "@webhare/whdb";
import { selectFSHighestParent, selectFSIsActive, selectFSLink, selectFSPublish, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { openType } from "@webhare/whfs/src/contenttypes";
import { isHistoricWHFSSpace } from "@webhare/whfs/src/path-support";
import { omit } from "@webhare/std";
import type { CSPContentType } from "@webhare/whfs/src/siteprofiles";
import { getAllContentTypes, getMetaTypeCategory, getSiteProfileMetaType, getTypeName } from "./whfs-types";

/** How an object refers to the type we're looking for:
 * - object: the object itself is of this type (eg. a form file, or a widget stored as a file)
 * - instance: the object has instance data of this type (eg. a folder with a 'settings' contenttype)
 * - embedded: the type is embedded in another instance of the object, eg. a widget in a rich text document
 */
export type FoundInstanceSource = "object" | "instance" | "embedded";

export interface FoundObjectRef {
  id: number;
  whfsPath: string;
  link: string;
  isFolder: boolean;
}

/** The information about a found instance, as passed to the --where expression as 'obj' */
export interface FoundInstanceInfo extends FoundObjectRef {
  /** The WHFS type that was found */
  type: string;
  name: string;
  /** Type of the object (file or folder type) holding the instance */
  objectType: string;
  /** Id of the site containing the object, null if not in a site */
  siteId: number | null;
  source: FoundInstanceSource;
  /** For embedded instances: the instance type and member containing it, eg. platform:filetypes.richdocument#data */
  embeddedIn?: string;
  /** For embedded instances: fs_settings id (pass to openType().getBySettingId to get the data) */
  settingId?: number;
}

export interface FoundInstance extends FoundInstanceInfo {
  data?: Record<string, unknown>;
  /** For objects of a widget type: objects referring to this widget file, eg. using an 'insert snippet' widget */
  referredBy?: FoundObjectRef[];
}

export interface FindInstancesOptions {
  /** JavaScript expression to filter with. Receives the instance data as '$' and the object info as 'obj' */
  where?: string;
  /** Members to load and return. '*' selects all members */
  select?: string[];
  /** Only return objects inside one of these folders (WHFS paths) */
  startFolders?: string[];
  /** Also return objects in the recycle bin, versions and drafts */
  all?: boolean;
  /** Options for exporting the selected data. If not set, the data is returned in 'get' format */
  exportOptions?: ExportOptions & { export: true };
}

type WhereFunction = ($: Record<string, unknown>, obj: FoundInstanceInfo) => unknown;

function compileWhere(expr: string): WhereFunction {
  try {
    //Evaluating the user's expression is the whole point of --where. This is a CLI tool so the user can already run any code
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return new Function("$", "obj", `"use strict"; return (${expr});`) as WhereFunction;
  } catch (e) {
    throw new Error(`Invalid --where expression: ${(e as Error).message}`);
  }
}

/** Thrown to abort a --where evaluation that touched a member which hasn't been loaded yet */
class NeedMoreMembersError extends Error { }

/** Evaluate the --where expression against (possibly partially) loaded instance data.
 *
 * The expression gets a read-only proxy as '$' which records any access to members that aren't loaded yet. We don't
 * try to figure out in advance which members an expression uses: we just run it, and if it touched unloaded members
 * we report them so the caller can load them and try again. Listing the keys (Object.keys, spreading, JSON.stringify)
 * requires all members.
 *
 * @param where - Compiled expression
 * @param data - Instance data. Must contain all members in 'loaded'
 * @param loaded - Members that are loaded into data
 * @param memberNames - All members of the type
 * @param obj - Object info to pass to the expression
 * @returns The expression's result, or the members to load before evaluating again
 */
function evaluateWhere(where: WhereFunction, data: Record<string, unknown>, loaded: ReadonlySet<string>, memberNames: readonly string[], obj: FoundInstanceInfo): { result: unknown } | { missing: Set<string> } {
  const missing = new Set<string>();
  const need = (names: string[]): never => {
    for (const name of names)
      missing.add(name);
    throw new NeedMoreMembersError(`Members not loaded yet: ${names.join(", ")}`);
  };
  const isUnloaded = (key: string | symbol): key is string => typeof key === "string" && memberNames.includes(key) && !loaded.has(key);

  const $ = new Proxy(data, {
    get: (target, key) => isUnloaded(key) ? need([key]) : Reflect.get(target, key),
    has: (target, key) => isUnloaded(key) ? need([key]) : Reflect.has(target, key),
    getOwnPropertyDescriptor: (target, key) => isUnloaded(key) ? need([key]) : Reflect.getOwnPropertyDescriptor(target, key),
    ownKeys: target => {
      const unloaded = memberNames.filter(name => !loaded.has(name));
      return unloaded.length ? need(unloaded) : Reflect.ownKeys(target);
    },
    //'$' is read-only, as we reuse the data for the next evaluation. Returning false makes these throw in strict mode
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  });

  try {
    const result = where($, obj);
    //If the expression caught our exception, the result isn't trustworthy either
    return missing.size ? { missing } : { result };
  } catch (e) {
    if (missing.size)
      return { missing };
    throw new Error(`--where expression failed for ${obj.whfsPath} (#${obj.id}): ${(e as Error).message}`);
  }
}

/** Check that every selected member exists in at least one of the types
 * @param typeMembers - Member names per type
 * @param select - Selected members
 */
function validateSelect(typeMembers: string[][], select: string[]) {
  const allMembers = [...new Set(typeMembers.flat())].sort();
  for (const name of select)
    if (name !== "*" && !allMembers.includes(name))
      throw new Error(`No such member '${name}', available members: ${allMembers.join(", ")}`);
}

/** Number of ids to look up per query, to stay well below PostgreSQL's limit on query parameters */
const objectInfoBatchSize = 10000;

async function getObjectInfo(ids: number[], options?: { link?: boolean }) {
  const result = new Map<number, Awaited<ReturnType<typeof queryObjectInfo>>[number]>();
  for (let start = 0; start < ids.length; start += objectInfoBatchSize)
    for (const row of await queryObjectInfo(ids.slice(start, start + objectInfoBatchSize), options?.link ?? true))
      result.set(row.id, row);
  return result;
}

function queryObjectInfo(ids: number[], link: boolean) {
  return db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "name", "isfolder", "type"])
    .select(selectFSWHFSPath().as("whfsPath"))
    .select((link ? selectFSLink() : sql<string>`''`).as("link")) //calculating links is relatively expensive
    .select(selectFSIsActive().as("isActive"))
    .select(selectFSPublish().as("isPublished"))
    .select(selectFSHighestParent().as("siteId"))
    .where("id", "in", ids)
    .execute();
}

type ObjectInfo = Awaited<ReturnType<typeof queryObjectInfo>>[number];

function toObjectRef(info: ObjectInfo): FoundObjectRef {
  return { id: info.id, whfsPath: info.whfsPath, link: info.link, isFolder: info.isfolder };
}

/** Find the objects using a type and apply the scope (startFolders, all) and the where expression
 * @param type - Type to look for
 * @param options - Search options. If 'referrals' is set, also look up the objects referring to widget files of this type
 *   and return them in 'referredBy'
 * @returns The matching instances, without their data
 */
async function gatherInstances(type: CSPContentType, options: Omit<FindInstancesOptions, "select" | "exportOptions"> & { referrals: boolean; links: boolean }) {
  const where = options.where ? compileWhere(options.where) : null;
  const accessor = openType(type.namespace);
  const memberNames = (await accessor.describe()).members.map(m => m.name);
  const isWidgetType = getMetaTypeCategory(getSiteProfileMetaType(type)) === "widget";
  const allTypes = new Map(getAllContentTypes().map(t => [t.id, t]));
  const getName = (typeId: number | null) => {
    const found = typeId ? allTypes.get(typeId) : undefined;
    return found ? getTypeName(found) : typeId ? String(typeId) : "";
  };

  // Gather candidates: objects of this type, objects with an instance of this type, settings embedding this type
  const [ofType, withInstance, embedded] = await Promise.all([
    db<PlatformDB>().selectFrom("system.fs_objects").select("id").where("type", "=", type.id).execute(),
    db<PlatformDB>().selectFrom("system.fs_instances").select("fs_object").where("fs_type", "=", type.id).execute(),
    db<PlatformDB>().selectFrom("system.fs_settings")
      .innerJoin("system.fs_instances", "system.fs_instances.id", "system.fs_settings.fs_instance")
      .innerJoin("system.fs_members", "system.fs_members.id", "system.fs_settings.fs_member")
      .select(["system.fs_settings.id as settingId", "system.fs_instances.fs_object", "system.fs_instances.fs_type", "system.fs_members.name as memberName"])
      .where("system.fs_settings.instancetype", "=", type.id)
      .orderBy("system.fs_settings.id")
      .execute()
  ]);

  const ofTypeIds = new Set(ofType.map(row => row.id));
  const objectIds = new Set([...ofTypeIds, ...withInstance.map(row => row.fs_object)]);

  // Objects referring to widget files of this type (eg. using an 'insert snippet' widget)
  const referrals = options.referrals && isWidgetType && ofTypeIds.size ? await db<PlatformDB>()
    .selectFrom("system.fs_settings")
    .innerJoin("system.fs_instances", "system.fs_instances.id", "system.fs_settings.fs_instance")
    .select(["system.fs_settings.fs_object as target", "system.fs_instances.fs_object as referrer"])
    .where("system.fs_settings.fs_object", "in", [...ofTypeIds])
    .execute() : [];

  const objInfo = await getObjectInfo([...new Set([...objectIds, ...embedded.map(row => row.fs_object), ...referrals.map(row => row.referrer)])], { link: options.links });

  const startPaths = options.startFolders?.map(path => path.toUpperCase().endsWith("/") ? path.toUpperCase() : path.toUpperCase() + "/");
  const inScope = (info: ObjectInfo | undefined): info is ObjectInfo => {
    if (!info)
      return false;
    if (!options.all && (!info.isActive || isHistoricWHFSSpace(info.whfsPath)))
      return false;
    return !startPaths?.length || startPaths.some(path => info.whfsPath.toUpperCase().startsWith(path));
  };

  const typeName = getTypeName(type);
  const makeInfo = (info: ObjectInfo, source: FoundInstanceSource): FoundInstanceInfo => ({
    type: typeName,
    id: info.id,
    whfsPath: info.whfsPath,
    link: info.link,
    isFolder: info.isfolder,
    name: info.name,
    objectType: getName(info.type),
    siteId: info.siteId,
    source,
  });

  // Direct instances (and objects of the type without stored instance data, which get the defaults)
  const directObjs = [...objectIds].map(id => objInfo.get(id)).filter(inScope);
  let matches = directObjs.map(info => ({ info, found: makeInfo(info, ofTypeIds.has(info.id) ? "object" : "instance") }));
  if (where) {
    /* Filter in rounds: evaluate the expression for all candidates, load the members it needed but which weren't
       loaded yet, and evaluate again for the candidates that needed them. Every round loads at least one more member,
       and all candidates still pending have all members in 'loaded' */
    const loaded = new Set<string>();
    let pending = matches.map(match => ({ ...match, data: {} as Record<string, unknown> }));
    matches = [];
    while (pending.length) {
      const missing = new Set<string>();
      const retry: typeof pending = [];
      for (const item of pending) {
        const outcome = evaluateWhere(where, item.data, loaded, memberNames, item.found);
        if ("missing" in outcome) {
          outcome.missing.forEach(name => missing.add(name));
          retry.push(item);
        } else if (outcome.result)
          matches.push(item);
      }

      if (retry.length) {
        //enrich() can't type member names for an untyped accessor, so cast them
        const newData = await accessor.enrich(retry.map(item => ({ fsObjectId: item.info.id })), "fsObjectId", [...missing] as never[]);
        newData.forEach((row, idx) => Object.assign(retry[idx].data, omit(row, ["fsObjectId"])));
        missing.forEach(name => loaded.add(name));
      }
      pending = retry;
    }
  }

  const direct: FoundInstance[] = [];
  for (const { info, found } of matches) {
    const result: FoundInstance = found;
    if (options.referrals && isWidgetType && ofTypeIds.has(info.id))
      result.referredBy = referrals.filter(r => r.target === info.id).map(r => objInfo.get(r.referrer)).filter(inScope).map(toObjectRef);
    direct.push(result);
  }

  // Embedded instances (widgets inside rich text, members of type 'instance')
  const embeddedMatches: Array<FoundInstance & { settingId: number }> = [];
  for (const row of embedded) {
    const info = objInfo.get(row.fs_object);
    if (!inScope(info))
      continue;

    const found = { ...makeInfo(info, "embedded"), embeddedIn: `${getName(row.fs_type)}#${row.memberName}`, settingId: row.settingId };
    if (where) { //getBySettingId always loads all members, so the expression can't need more
      const data = await accessor.getBySettingId(row.settingId) as Record<string, unknown>;
      const outcome = evaluateWhere(where, data, new Set(memberNames), memberNames, found);
      if (!("result" in outcome && outcome.result))
        continue;
    }
    embeddedMatches.push(found);
  }

  return { accessor, direct, embedded: embeddedMatches };
}

/** Find the files and folders using one or more types
 * @param types - Types to look for
 * @param options - Search options. A selected member only needs to exist in one of the types
 * @returns The found instances, sorted by path
 */
export async function findInstances(types: CSPContentType[], options: FindInstancesOptions): Promise<FoundInstance[]> {
  const typeMembers = await Promise.all(types.map(async type => (await openType(type.namespace).describe()).members.map(m => m.name)));
  if (options.select?.length) //validate before doing the actual work
    validateSelect(typeMembers, options.select);

  const results: FoundInstance[] = [];
  for (const [idx, type] of types.entries()) {
    const { accessor, direct, embedded } = await gatherInstances(type, { ...options, referrals: true, links: true });
    const select = options.select?.filter(name => name === "*" || typeMembers[idx].includes(name));
    if (select?.length) {
      for (const found of direct)
        found.data = selectData((options.exportOptions ? await accessor.get(found.id, options.exportOptions) : await accessor.get(found.id)) as Record<string, unknown>, select);
      for (const found of embedded)
        found.data = selectData((options.exportOptions ? await accessor.getBySettingId(found.settingId, options.exportOptions) : await accessor.getBySettingId(found.settingId)) as Record<string, unknown>, select);
    }
    results.push(...direct, ...embedded);
  }

  return results.sort((lhs, rhs) => lhs.whfsPath.localeCompare(rhs.whfsPath) || lhs.type.localeCompare(rhs.type) || (lhs.settingId ?? 0) - (rhs.settingId ?? 0));
}

export interface FoundInstanceCount {
  /** Number of files and folders of this type */
  objects: number;
  /** Number of files and folders with instance data of this type */
  instances: number;
  /** Number of embedded instances of this type, eg. widgets inside rich text. One document can embed a type multiple times */
  embedded: number;
  /** Number of distinct files and folders using this type in any of the above ways */
  total: number;
}

/** Count the files and folders that would be returned by findInstances
 * @param type - Type to look for
 * @param options - Search options
 */
export async function countInstances(type: CSPContentType, options: Omit<FindInstancesOptions, "select" | "exportOptions">): Promise<FoundInstanceCount> {
  //only calculate links if the where expression may need them
  const { direct, embedded } = await gatherInstances(type, { ...options, referrals: false, links: Boolean(options.where) });
  return {
    objects: direct.filter(found => found.source === "object").length,
    instances: direct.filter(found => found.source === "instance").length,
    embedded: embedded.length,
    total: new Set([...direct, ...embedded].map(found => found.id)).size
  };
}

function selectData(data: Record<string, unknown>, select: string[]): Record<string, unknown> {
  if (select.includes("*"))
    return data;
  return Object.fromEntries(select.map(name => [name, data[name]]));
}

/** Schedule republishing of the found objects (and the objects referring to them)
 * @returns Number of files and folders scheduled
 */
export async function republishFoundInstances(found: FoundInstance[]): Promise<{ files: number; folders: number }> {
  const objects = new Map<number, FoundObjectRef>();
  for (const item of found)
    for (const ref of [item, ...item.referredBy ?? []])
      objects.set(ref.id, ref);

  const info = await getObjectInfo([...objects.keys()]);
  const control = loadlib("mod::publisher/lib/control.whlib");
  const result = { files: 0, folders: 0 };
  await runInWork(async () => {
    for (const obj of objects.values()) {
      if (obj.isFolder) {
        await control.scheduleFolderRepublish(obj.id, true);
        ++result.folders;
      } else if (info.get(obj.id)?.isPublished) {
        await control.scheduleFileRepublish(obj.id);
        ++result.files;
      }
    }
  });
  return result;
}
