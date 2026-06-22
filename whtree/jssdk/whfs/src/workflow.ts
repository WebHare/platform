//TODO not sure if we should *actually* offer the HS API to TS in the same shape

import { makeObject, type HSVMObject } from "@webhare/harescript";
import { whfsType, type WHFSTypes } from "@webhare/whfs/src/contenttypes";

class WorkFlowManager {
  constructor(private hsMgr: HSVMObject) {

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

export async function openWorkflowManager(fileId: number, options?: WorklowOptions) {
  const hsMgr = await makeObject("mod::publisher/lib/history.whlib#WorkflowManager", fileId, {
    useworkflow: options?.useWorkflow ?? false,
    workflowtypes: options?.workflowTypes ?? [],
    assumewriteaccess: options?.assumeWriteAccess ?? false
  });

  return new WorkFlowManager(hsMgr);
}

export type { WorkFlowManager };
