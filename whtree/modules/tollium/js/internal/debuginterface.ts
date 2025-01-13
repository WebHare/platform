/* @mod-tollium/js/internal/debuginterface exposes an API for the debug module. It allows us to offer
   a slight bit of stability and type checking */

import type { BackendApplication, registerJSApp } from "@mod-tollium/web/ui/js/application";
import type { componentsToMessages, getActiveApplication } from "@mod-tollium/web/ui/js/support";
import type { ToddCompBase } from "@mod-tollium/web/ui/js/componentbase";

class TolliumHooks {
  onMagicMenu?: (comp: ToddCompBase, submenu: HTMLUListElement) => void;
}

declare global {
  interface Window {
    $tollium?: {
      registerJSApp: typeof registerJSApp;
      componentsToMessages: typeof componentsToMessages;
      getActiveApplication: typeof getActiveApplication;
    };
    $tolliumhooks?: TolliumHooks;
  }
}

export { ToddCompBase, BackendApplication };
