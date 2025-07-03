// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/services" {
}

import * as fs from "node:fs";
import { backendConfig } from "./config";
import type { UploadManifest } from "@webhare/upload";
import type { AccessLogLine, PxlLogLine } from "./logging";
import type { RichTextDocument } from "./richdocument";

export { registerResourceDependency, addResourceChangeListener } from "@webhare/services/src/hmr.ts";
export { toFSPath, toResourcePath, resolveResource, isAbsoluteResource, parseResourcePath, getResourceEventMasks } from "./resources";
export { openBackendService, type GetBackendServiceInterface } from "./backendservice";
export { runBackendService, BackendServiceConnection, type BackendServiceController } from "./backendservicerunner";
export { backendConfig } from "./config";
export type { WebHareBackendConfiguration } from "./config";
export { broadcast, subscribe, subscribeToEventStream, signalOnEvent } from "./backendevents";
export type { BackendEvent, BackendEventSubscription } from "./backendevents";

export { log, logNotice, logError, logDebug, readLogLines } from "./logging";
export type { LoggableRecord } from "./logmessages";

export { ResourceDescriptor } from "./descriptor";
export { lockMutex, type Mutex } from "./mutex";

export { TaskRequest, scheduleTask, scheduleTimedTask, retrieveTaskResult, cancelTask, cancelManagedTasks, listTasks, describeTask, retryTask } from "./tasks";
export type { TaskFunction, TaskResponse } from "./tasks";

export { readRegistryKey, writeRegistryKey, getRegistryKeyEventMasks, readRegistryNode, deleteRegistryKey, deleteRegistryNode, signalOnRegistryKeyChange } from "./registry";
export { WebHareBlob } from "./webhareblob";
export { getSignatureForThisServer, validateSignatureForThisServer, encryptForThisServer, decryptForThisServer } from "./secrets";
export { prepareMail } from "./mail";
export { applyConfiguration, createAppliedPromise } from "./applyconfig";
export { fetchResource } from "./fetchresource";
export { createServerSession, getServerSession, closeServerSession, updateServerSession, createUploadSession, getUploadedFile } from "./sessions";
export { WittyEncodingStyle, type WittyOptions } from "@webhare/witty";
export { loadWittyResource } from "./witty.ts";
export { importJSFunction, importJSObject, JSLibraryImporter, signalOnImportChange, signalOnResourceChange, type ImportedJSLibrary as ImportedJSLibrary } from "./resourcetools.ts";

export { buildRTD, buildWidget, RichTextDocument } from "./richdocument";
export type { WHFSInstance, Widget, RTDBuildSource } from "./richdocument";

export type { CheckResult, CheckFunction } from "@mod-platform/js/checks/checkapi";
export type { ContentValidationFunction, ValidationState, ValidationOptions } from "@mod-platform/js/devsupport/validation";
export { IntExtLink } from "./intextlink";

export { matchesThisServer, type IfWebHare } from "@mod-system/js/internal/generation/shared.ts";

/** Extend this interface to register broadcast event formats */
export interface BackendEvents {
  "platform:assetpackcontrol.update": { assetpacks: string[] };
  "system:managedtasks.any.new": { taskids: number[] };
}

/** Extend this interface to define the format of your own secret scopes */
export interface ServerEncryptionScopes {
}

/** Extend this interface to describe backend services */
export interface BackendServices {
}

/** Common logging formats */
export interface LogFormats {
  /** Webserver PXL log */
  "platform:pxl": PxlLogLine;
  /** Webserver access log */
  "platform:access": AccessLogLine;
}

/** Extend this interface to define the format of your own sessions  */
export interface SessionScopes {
  [key: string]: Record<string, unknown>;

  "platform:uploadsession": {
    manifest: UploadManifest;
    chunkSize: number;
  };
}

export async function isWebHareRunning() {
  /* TODO it would be better to attempt to connect to the bridge to test online-ness *if* we can get the bridge to immediately report it cannot connect?
          pid analysis is even less reliable in node as we can't test process names */
  try {
    const pidfile = fs.readFileSync(backendConfig.dataRoot + ".webhare.pid", 'utf-8');
    const pid = parseInt(pidfile);
    return Boolean(pid);
  } catch (e) {
    return false;
  }
}

/** @deprecated From WH5.7+, we'll rename RichDocument to RichTextDocument to strictly match the RTD initials */
export type RichDocument = RichTextDocument;
