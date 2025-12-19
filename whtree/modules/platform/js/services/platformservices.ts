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
    "platform:webserver": WebServerClient;
    "publisher:publication": PublicationService;
    "publisher:outputanalyzer": OutputAnalyzerService;
  }
}

type PersistentQueueStats<TaskItem> = {
  status: "ok";
  running: Array<{ taskdata: TaskItem; date_running: Date }>;
  runnable: number;
  timedwait: number;
  queuestats: {
    fields: Array<{ name: string; type: "level" | "event" }>;
    interval: number;
    history: Array<{ intervalstart: Date; queuelength: { firstvalue: number; lastvalue: number; minvalue: number; maxvalue: number }; finished: number }>;
    currentstatus: { intervalstart: Date; queuelength: { firstvalue: number; lastvalue: number; minvalue: number; maxvalue: number }; finished: number };
  };
};

type PublicationTaskItem = { id: number; priority: number; lastpublishtime: number };
type PublicationService = {
  schedule(item: PublicationTaskItem): Promise<{
    scheduled: Array<PublicationTaskItem>;
    updated: Array<PublicationTaskItem>;
  }>;
  scheduleMultiple(items: PublicationTaskItem[]): Promise<{
    scheduled: Array<PublicationTaskItem>;
    updated: Array<PublicationTaskItem>;
  }>;
  getState(): Promise<PersistentQueueStats<PublicationTaskItem> & {
    expectedtimetocompletion: bigint;
  }>;
  testFilesScheduled(ids: number[]): Promise<number[]>;
  getExpectedTimeToCompletion(id: number): Promise<number>;
  shutdown(): Promise<void>;
};

type OutputAnalyzerTaskItem = { action: "SCAN"; folderid: number; recursive: boolean } | { action: "GATHERFOLDERS" };
type OutputAnalyzerService = {
  schedule(item: OutputAnalyzerTaskItem & { priority?: number }): Promise<{
    scheduled: Array<OutputAnalyzerTaskItem>;
    updated: Array<OutputAnalyzerTaskItem>;
  }>;
  scheduleMultiple(items: (OutputAnalyzerTaskItem & { priority?: number })[]): Promise<{
    scheduled: Array<OutputAnalyzerTaskItem>;
    updated: Array<OutputAnalyzerTaskItem>;
  }>;
  getState(): Promise<PersistentQueueStats<PublicationTaskItem>>;
  testFoldersScheduled(ids: number[]): Promise<number[]>;
  shutdown(): Promise<void>;
};


//TypeScript issue - if we don't import it explicitly, TS looks to us for the "@webhare/services" and suddenly can't find @webhare/services anymore
import type { BackendServices, GetBackendServiceInterface } from "@webhare/services";
import type { WebServerClient } from "../webserver/webserver";
export { type BackendServices, type GetBackendServiceInterface }; //import/export gives us 'something to do' and users 'something to import' in the TypesScript sense. this library should otherwise stay empty
