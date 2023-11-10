/* @mod-tollium/js/internal/debuginterface exposes an API for the debug module. It allows us to offer
   a slight bit of stability and type checking */

import { registerJSApp } from "@mod-tollium/web/ui/js/application";
import { componentsToMessages, getActiveApplication } from "@mod-tollium/web/ui/js/support";

declare global {
  interface Window {
    $tollium?: {
      registerJSApp: typeof registerJSApp;
      componentsToMessages: typeof componentsToMessages;
      getActiveApplication: typeof getActiveApplication;
    };
  }
}

export { ToddCompBase } from "@mod-tollium/web/ui/js/componentbase";
