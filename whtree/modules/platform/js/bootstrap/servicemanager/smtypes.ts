import type { ProcessManager } from "./main";
export enum Stages { Bootup, StartupScript, Active, Terminating, ShuttingDown }

export interface ServiceDefinition {
  cmd: string[];
  startIn: Stages;
  ///stopIn should be used by passive services (ie that only respond to others) to stay up as active processes get terminated, mostly to reduce screams in the log
  stopIn?: Stages;
  ///stopSignal (defaults to SIGTERM)
  stopSignal?: NodeJS.Signals;
  ///Restart this service if it fails?
  keepAlive: boolean;
  ///Wait for this script to complete before moving to the next stage (TODO this may make keepAlive obsolete?)
  waitForCompletion?: boolean;
  ///override the stopTimeout. we used to do this for the WH databse server
  stopTimeout?: number;
  isExitFatal?: (terminationcode: string | number) => boolean;
  current?: ProcessManager;
}
