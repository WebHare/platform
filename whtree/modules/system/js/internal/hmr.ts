import { handleModuleInvalidation, handleSoftReset } from "./hmrinternal";
export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate, registerLoadedResource } from "./hmrinternal";
import * as resources from "@webhare/services/src/resources";
import whbridge from "@mod-system/js/internal/whmanager/bridge";

// non-bridge stuff is placed into hmrinternal so it can be loaded first (bridge also registers as non-reloadable)

async function gotEvent({ name, data }: { name: string; data: unknown }) {
  if (name.startsWith("system:modulefolder.") && typeof data === "object" && data) {
    let resource = (data as { resourcename?: string })?.resourcename ?? null;
    if (!resource)
      return;

    if (resource.startsWith("direct::"))
      resource = resource.substring(8);
    else {
      resource = resources.toFSPath(resource, { allowUnmatched: true });
      if (!resource)
        return;
    }

    handleModuleInvalidation(resource);
  }
  if (name === "system:softreset") {
    handleSoftReset();
  }
}

whbridge.on("event", evt => gotEvent(evt));
