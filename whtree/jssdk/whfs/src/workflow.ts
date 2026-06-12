//TODO not sure if we should *actually* offer the HS API to TS in the same shape

import { makeObject, type HSVMObject } from "@webhare/harescript";
import { whfsType, type WHFSTypes } from "@webhare/whfs/src/contenttypes";

class WorkFlowManager {
  constructor(private hsMgr: HSVMObject) {

  }

  async set<const Type extends keyof WHFSTypes>(ns: Type, data: WHFSTypes[Type]["SetFormat"]): Promise<void> {
    const id = await this.hsMgr.__GetWriteableAutosveId();
    return await whfsType(ns).set(id, data, { ifReadOnly: "update" });
  }

  async save(options?: {
    finalize: boolean;
  }): Promise<void> {
    return await this.hsMgr.save({ finalize: options?.finalize ?? false });
  }
}

export type WorklowOptions = {
  useWorkflow?: boolean;
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
