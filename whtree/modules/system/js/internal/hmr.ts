import { handleModuleInvalidation } from "./hmrinternal";
export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate } from "./hmrinternal";
import * as services from "@webhare/services";
import whbridge from "@mod-system/js/internal/whmanager/bridge";

// non-bridge stuff is placed into hmrinternal so it can be loaded first (bridge also registers as non-reloadable)

async function gotEvent({ name, data }: { name: string; data: unknown }) {
  if (name.startsWith("system:modulefolder.") && typeof data == "object" && data) {
    let resource = (data as { resourcename?: string })?.resourcename;
    if (!resource)
      return;
    try {
      if (resource.startsWith("direct::"))
        resource = resource.substring(8);
      else {
        await services.ready();
        resource = services.toFSPath(resource);
      }

      handleModuleInvalidation(resource);
    } catch (e) {
      return;
    }
  }
}

whbridge.on("event", evt => gotEvent(evt));
