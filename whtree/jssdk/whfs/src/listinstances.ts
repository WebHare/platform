import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import { db, sql } from "@webhare/whdb";

export type ListInstancesOptions = {
  withOrphans?: boolean;
};

export type ListInstancesResult = {
  /// WHFS object id
  fsObject: number;
  // Namespace of the content type
  namespace: string;
  // Scoped type of the content type
  scopedType: string | null;
  /// Indicator whether this instance is cloned when copying or archiving
  clone: "onCopy" | "onArchive" | "never";
  /// This instance is managed as part of a workflow (drafts/autosaves)
  workflow: boolean;
  /** True if this content type is not defined in the site profile configuration anymore (these instances are
      hidden unless option withOrphans is set) */
  orphan: boolean;
}[];

/** List all stored instancecs for a number of WHFS objects
 * @param objId - One or more WHFS object IDs to list content types for
 * @param options.withOrphans - If true, also include content types that are not defined in the site profile configuration
 * @returns An array of content type information objects
*/
export async function listInstances(objId: number | number[], options?: ListInstancesOptions): Promise<ListInstancesResult> {
  const objIds = Array.isArray(objId) ? objId : [objId];

  const instances = await db<PlatformDB>()
    .selectFrom("system.fs_instances")
    .innerJoin("system.fs_types", "system.fs_types.id", "system.fs_instances.fs_type")
    .select([
      "system.fs_instances.fs_object as fsObject",
      "system.fs_instances.workflow",
      "system.fs_types.namespace",
      "system.fs_types.scopedtype as scopedType",
      "system.fs_types.cloneoncopy as cloneOnCopy",
      "system.fs_types.cloneonarchive as cloneOnArchive",
      "system.fs_types.orphan",
    ])
    .where("system.fs_instances.fs_object", "=", sql<number>`any(${objIds})`)
    .orderBy("system.fs_instances.fs_object")
    .orderBy("system.fs_types.namespace")
    .execute();

  const types = getExtractedHSConfig("siteprofiles").contenttypes;
  return instances.map(inst => {
    const type = types.find(t => t.namespace === inst.namespace);
    if ((!type || inst.orphan) && !options?.withOrphans)
      return null;
    return ({
      fsObject: inst.fsObject,
      namespace: inst.namespace,
      scopedType: inst.scopedType,
      clone: inst.cloneOnCopy ? "onCopy" as const : (inst.cloneOnArchive ? "onArchive" as const : "never" as const),
      workflow: inst.workflow,
      orphan: inst.orphan || !type,
    });
  }).filter(_ => _ !== null);
}
