/* Support for `wh whfs find-instances` */

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import type { ExportOptions } from "@webhare/services/src/descriptor";
import { db, runInWork } from "@webhare/whdb";
import { selectFSHighestParent, selectFSIsActive, selectFSLink, selectFSPublish, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { openType, type WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
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
  /** Only return objects inside this folder (a WHFS path) */
  under?: string;
  /** Also return objects in the recycle bin, versions and drafts */
  all?: boolean;
  /** Options for exporting the selected data. If not set, the data is returned in 'get' format */
  exportOptions?: ExportOptions & { export: true };
}

type WhereFunction = ($: Record<string, unknown>, obj: FoundInstanceInfo) => unknown;

function compileWhere(expr: string): WhereFunction {
  let compiled: WhereFunction;
  try {
    //Evaluating the user's expression is the whole point of --where. This is a CLI tool so the user can already run any code
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    compiled = new Function("$", "obj", `"use strict"; return (${expr});`) as WhereFunction;
  } catch (e) {
    throw new Error(`Invalid --where expression: ${(e as Error).message}`);
  }
  return ($, obj) => {
    try {
      return compiled($, obj);
    } catch (e) {
      throw new Error(`--where expression failed for ${obj.whfsPath} (#${obj.id}): ${(e as Error).message}`);
    }
  };
}

/** Determine which members we need to load: the selected ones plus anything the where expression might refer to */
function getMembersToLoad(members: WHFSTypeMember[], options: FindInstancesOptions): string[] {
  if (options.select?.includes("*"))
    return members.map(m => m.name);

  const toLoad = new Set<string>();
  for (const name of options.select ?? []) {
    if (!members.some(m => m.name === name))
      throw new Error(`No such member '${name}', available members: ${members.map(m => m.name).join(", ")}`);
    toLoad.add(name);
  }
  if (options.where) //cheap superset: any member whose name appears as a word in the expression
    for (const member of members)
      if (new RegExp(`\\b${member.name.replace(/[$]/g, "\\$&")}\\b`).test(options.where))
        toLoad.add(member.name);
  return [...toLoad];
}

async function getObjectInfo(ids: number[]) {
  if (!ids.length)
    return new Map();

  const rows = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "name", "isfolder", "type"])
    .select(selectFSWHFSPath().as("whfsPath"))
    .select(selectFSLink().as("link"))
    .select(selectFSIsActive().as("isActive"))
    .select(selectFSPublish().as("isPublished"))
    .select(selectFSHighestParent().as("siteId"))
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map(row => [row.id, row]));
}

type ObjectInfo = Awaited<ReturnType<typeof getObjectInfo>> extends Map<number, infer T> ? T : never;

function toObjectRef(info: ObjectInfo): FoundObjectRef {
  return { id: info.id, whfsPath: info.whfsPath, link: info.link, isFolder: info.isfolder };
}

export async function findInstances(type: CSPContentType, options: FindInstancesOptions): Promise<FoundInstance[]> {
  const where = options.where ? compileWhere(options.where) : null;
  const accessor = openType(type.namespace);
  const { members } = await accessor.describe();
  const membersToLoad = getMembersToLoad(members, options);
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
  const referrals = isWidgetType && ofTypeIds.size ? await db<PlatformDB>()
    .selectFrom("system.fs_settings")
    .innerJoin("system.fs_instances", "system.fs_instances.id", "system.fs_settings.fs_instance")
    .select(["system.fs_settings.fs_object as target", "system.fs_instances.fs_object as referrer"])
    .where("system.fs_settings.fs_object", "in", [...ofTypeIds])
    .execute() : [];

  const objInfo = await getObjectInfo([...new Set([...objectIds, ...embedded.map(row => row.fs_object), ...referrals.map(row => row.referrer)])]);

  let underPath = options.under?.toUpperCase();
  if (underPath && !underPath.endsWith("/"))
    underPath += "/";
  const inScope = (info: ObjectInfo | undefined): info is ObjectInfo => {
    if (!info)
      return false;
    if (!options.all && (!info.isActive || isHistoricWHFSSpace(info.whfsPath)))
      return false;
    return !underPath || info.whfsPath.toUpperCase().startsWith(underPath);
  };

  const makeInfo = (info: ObjectInfo, source: FoundInstanceSource): FoundInstanceInfo => ({
    id: info.id,
    whfsPath: info.whfsPath,
    link: info.link,
    isFolder: info.isfolder,
    name: info.name,
    objectType: getName(info.type),
    siteId: info.siteId,
    source,
  });

  const results: FoundInstance[] = [];

  // Direct instances (and objects of the type without stored instance data, which get the defaults)
  const directObjs = [...objectIds].map(id => objInfo.get(id)).filter(inScope);
  //enrich() can't type member names for an untyped accessor, so cast them
  const directData = new Map((await accessor.enrich(directObjs.map(info => ({ fsObjectId: info.id })), "fsObjectId", membersToLoad as never[])).map(row => [row.fsObjectId, omit(row, ["fsObjectId"]) as Record<string, unknown>]));
  for (const info of directObjs) {
    const found = makeInfo(info, ofTypeIds.has(info.id) ? "object" : "instance");
    const data = directData.get(info.id)!;
    if (where && !where(data, found))
      continue;

    const result: FoundInstance = found;
    if (options.select?.length)
      result.data = selectData(options.exportOptions ? await accessor.get(info.id, options.exportOptions) as Record<string, unknown> : data, options.select);
    if (isWidgetType && ofTypeIds.has(info.id))
      result.referredBy = referrals.filter(r => r.target === info.id).map(r => objInfo.get(r.referrer)).filter(inScope).map(toObjectRef);
    results.push(result);
  }

  // Embedded instances (widgets inside rich text, members of type 'instance')
  for (const row of embedded) {
    const info = objInfo.get(row.fs_object);
    if (!inScope(info))
      continue;

    const found: FoundInstance = { ...makeInfo(info, "embedded"), embeddedIn: `${getName(row.fs_type)}#${row.memberName}`, settingId: row.settingId };
    if (where || options.select?.length) {
      const data = await accessor.getBySettingId(row.settingId) as Record<string, unknown>;
      if (where && !where(data, found))
        continue;
      if (options.select?.length)
        found.data = selectData(options.exportOptions ? await accessor.getBySettingId(row.settingId, options.exportOptions) as Record<string, unknown> : data, options.select);
    }
    results.push(found);
  }

  return results.sort((lhs, rhs) => lhs.whfsPath.localeCompare(rhs.whfsPath) || (lhs.settingId ?? 0) - (rhs.settingId ?? 0));
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
