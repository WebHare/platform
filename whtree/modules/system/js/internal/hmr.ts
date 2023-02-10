import { handleModuleInvalidation, handleSoftReset } from "./hmrinternal";
export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate } from "./hmrinternal";
import * as services from "@webhare/services";
import whbridge from "@mod-system/js/internal/whmanager/bridge";
import { calculateWebHareConfiguration } from "@mod-system/js/internal/configuration";

// non-bridge stuff is placed into hmrinternal so it can be loaded first (bridge also registers as non-reloadable)

async function gotEvent({ name, data }: { name: string; data: unknown }) {
  if (name.startsWith("system:modulefolder.") && typeof data == "object" && data) {
    let resource = (data as { resourcename?: string })?.resourcename ?? null;
    if (!resource)
      return;

    if (resource.startsWith("direct::"))
      resource = resource.substring(8);
    else {
      await services.ready();
      resource = services.toFSPath(resource, { allowUnmatched: true });
      if (!resource)
        return;
    }

    handleModuleInvalidation(resource);
  }
  if (name === "system:softreset") {
    // FIXME: need saved configurations here!
    const config = calculateWebHareConfiguration();
    handleSoftReset(config);
  }
}

whbridge.on("event", evt => gotEvent(evt));
