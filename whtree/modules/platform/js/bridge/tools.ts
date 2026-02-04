import bridge from "@mod-system/js/internal/whmanager/bridge";
import { DebugMgrClientLinkRequestType, type DebugMgrClientLink } from "@mod-system/js/internal/whmanager/debug";
import type { MutexManagerLinkType } from "@webhare/services/src/mutex";
import { throwError } from "@webhare/std";

export async function getInspectorURL(process: string): Promise<string> {
  using link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
  await link.activate();
  const inspectorinfo = await link.doRequest({
    type: DebugMgrClientLinkRequestType.enableInspector,
    processid: process
  });
  return inspectorinfo?.url || throwError("Could not get an inspector URL");
}

export async function listLocks() {
  using link = bridge.connect<MutexManagerLinkType>("system:mutexmanager", { global: true });
  await link.activate();

  const statusrequest = await link.doRequest({ task: "status" });
  return statusrequest;
}
