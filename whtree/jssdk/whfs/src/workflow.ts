//TODO not sure if we should *actually* offer the HS API to TS in the same shape

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { makeObject, type HSVMObject } from "@webhare/harescript";
import { db, nextVal } from "@webhare/whdb";
import { whfsType, type WHFSTypes } from "@webhare/whfs/src/contenttypes";
import { createWHFSObject } from "./objects";
import { getType } from "./describe";
import { throwError } from "@webhare/std";
import { whconstant_whfsid_whfs_snapshots } from "@mod-system/js/internal/webhareconstants";
import { IntExtLink } from "@webhare/services/src/intextlink";

class WorkFlowManager {
  private hsMgr: HSVMObject;

  constructor(hsMgr: HSVMObject) {
    this.hsMgr = hsMgr;

  }

  async set<const Type extends keyof WHFSTypes>(ns: Type, data: WHFSTypes[Type]["SetFormat"]): Promise<void> {
    const id = await this.hsMgr.__GetWriteableAutosaveId();
    return await whfsType(ns).set(id, data, { ifReadOnly: "update" });
  }

  async save(options?: {
    finalize: boolean;
  }): Promise<void> {
    return await this.hsMgr.save({ finalize: options?.finalize ?? false });
  }
}

export type WorklowOptions = {
  /** If true, only show workflow-enabled tabs */
  useWorkflow?: boolean;
  /** Specify the workflow types we intend to update.
      We need this list as we can't assume you'll edit *all* workflow supporting types and we need to lock down the actual values of all workflowed types as soon as you save the first draft
      (even if you're not touching them)
  */
  workflowTypes?: string[];
  assumeWriteAccess?: boolean;
};

//TODO - To avoid races, create WHFS folders for a site immediately when creating the site. But having multiple shouldn't really matter..
async function ensureWHFSSiteFolder(parent: number, site: number | null): Promise<number> {
  //Always prefer the 'oldest' version folder. cleanversions will merge newers into the oldest anyway
  const versionRoot = await db<PlatformDB>().selectFrom("system.fs_objects").where("parent", "=", parent).where("filelink", "=", site).select("id").orderBy("creationdate").executeTakeFirst();
  if (versionRoot)
    return versionRoot.id;

  const newVersionDir = await nextVal("system.fs_objects.id");
  const type = getType("platform:foldertypes.default") ?? throwError("Could not find default folder type");
  await createWHFSObject({ id: parent, parentSite: null }, newVersionDir.toString(), type, {
    id: newVersionDir,
    target: site ? new IntExtLink(site) : null
  });
  return newVersionDir;
}

export async function ensureSnapshotsFolder(site: number | null) {
  return await ensureWHFSSiteFolder(whconstant_whfsid_whfs_snapshots, site);
}

export async function openWorkflowManager(fileId: number, options?: WorklowOptions) {
  const hsMgr = await makeObject("mod::publisher/lib/history.whlib#WorkflowManager", fileId, {
    workflowtypes: options?.workflowTypes ?? [],
    assumewriteaccess: options?.assumeWriteAccess ?? false
  });

  return new WorkFlowManager(hsMgr);
}

export type { WorkFlowManager };
