import type { AssetPackControlClient } from "../assetpacks/control";
import type { ServiceManagerClient } from "../bootstrap/servicemanager/main";
import type { NodeServicesClient } from "../nodeservices/nodeservices";
import type { ConfigClient } from "../configure/configservice";

/** Describes HareScript-based services */
declare module "@webhare/services" {
  interface BackendServices {
    "system:chromeheadlessrunner": {
      getConnectParams(): Promise<{
        connectorurl: string;
      }>;
    };
    "system:managedqueuemgr": {
      /// Make sure all cancelled tasks have been terminated
      stopCancelledTasks(): Promise<void>;
    };
    "platform:assetpacks": AssetPackControlClient;
    "platform:configuration": ConfigClient;
    "platform:coreservices": NodeServicesClient;
    "platform:nodeservices": NodeServicesClient;
    "platform:servicemanager": ServiceManagerClient;
  }
}

//TypeScript issue - if we don't import it explicitly, TS looks to us for the "@webhare/services" and suddenly can't find @webhare/services anymore
import type { BackendServices, GetBackendServiceInterface } from "@webhare/services";
export { type BackendServices, type GetBackendServiceInterface }; //import/export gives us 'something to do' and users 'something to import' in the TypesScript sense. this library should otherwise stay empty
