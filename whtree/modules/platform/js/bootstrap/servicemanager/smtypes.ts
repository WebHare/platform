import { pick, stringify } from "@webhare/std";

/** This enum must be ordered in the normal order (so we can say a service must be running when service.startIn &lt;= current stage &lt;= service.stopIn ?? DefaultStopStage).
 */
export enum Stage { Bootup, StartupScript, Active, Terminating, ShuttingDown }

export const defaultShutDownStage = Stage.Terminating;

/** The WebHare version file contains basic build/runtime info about this installation for use by upgrade scripts, automated checks and other things for the underlying platform */
export type WebHareVersionFile = {
  basedataroot: string;
  branch: string;
  builddatetime: string;
  committag: string;
  docker: boolean;
  installationroot: string;
  moduledirs: readonly string[];
  origin: string;
  version: string;
  versionnum: number;
  /** Service manager instance id, unique per 'wh console' launch. Set and exporterd to subprocesses in the WEBHARE_SERVICEMANAGERID environment variable by the primary servicemanager */
  servicemanagerid: string;
  /** Startup time of this service manager instance */
  startdatetime: string;
};

export interface ServiceDefinition {
  cmd: string[];
  /** When waitForCompletion is set to true, the service is started in startIn. Otherwise, a service is
   * kept running when service.startIn &lt;= currentStage &lt;= service.stopIn (unless keepAlive is false)
   */
  startIn: Stage;
  ///stopIn should be used by passive services (ie that only respond to others) to stay up as active processes get terminated, mostly to reduce screams in the log. Defaults to DefaultShutdownStage.
  stopIn?: Stage;
  ///stopSignal (defaults to SIGTERM)
  stopSignal?: NodeJS.Signals;
  ///override the stopTimeout. we used to do this for the WH database server
  stopTimeout?: number;
  ///when criticalForStartup is true and the service crashes during stage Bootup or StartupScript, WebHare will terminate
  criticalForStartup?: boolean;
  ///Minimum amount of time the service must have been running before being considered stable and not require a throttle during restart. Defaults to 60_000 (1 minute)
  minRunTime?: number;
  ///Maximum amount of time to throttle the service if it exits too fast and has to be restarted. Defaults to 60_000 (1 minute)
  maxThrottleMsecs?: number;
  /** Run type:
   * always: always run the service in the requested stages
   * once: run this script once the stage advances to startIn, and wait for this script to complete before moving to the next stage
   * on-demand: start the service when someone connects to its backend service
   * */
  run: "always" | "on-demand" | "once";
}

function getServiceRuntimeParamHash(service: ServiceDefinition) {
  return stringify(pick(service, ["cmd"]), { stable: true });
}

export function shouldRestartService(oldservice: ServiceDefinition, newservice: ServiceDefinition) {
  return getServiceRuntimeParamHash(oldservice) !== getServiceRuntimeParamHash(newservice);
}
