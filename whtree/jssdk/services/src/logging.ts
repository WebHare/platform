import bridge, { LogErrorOptions, LogNoticeOptions } from "@mod-system/js/internal/whmanager/bridge";
import { LoggableRecord } from "./logmessages";
import { backendConfig } from "./services";
import fs from "fs/promises";
import { checkModuleScopedName } from "./naming";
import { getModuleDefinition } from "./moduledefinitions";
import { escapeRegExp } from "@webhare/std";
import { readFileSync } from "fs";

type LogReadField = string | number | boolean | null | LogReadField[] | { [key: string]: LogReadField };
type LogLineBase = { "@timestamp": Date };
/** Write a line to a log file
    @param logname - Name of the log file
    @param logline - Line to log - as string or as object (will have a \@timestamp added and be converted to JSON)
*/
export function log(logname: string, logline: LoggableRecord): void {
  bridge.log(logname, logline);
}

/** Log a message to the notice log
 * @param type - Message type
 * @param message - Message to log
 */
export function logNotice(type: "error" | "warning" | "info", message: string, options?: LogNoticeOptions): void {
  if (!["error", "warning", "info"].includes(type))
    throw new Error(`Invalid log type '${type}'. Must be one of 'error', 'warning' or 'info'`);
  bridge.logNotice(type, message, options);
}

/** Log an error to the notice log
 * @param error - Error to log
 */
export function logError(error: Error, options?: LogErrorOptions): void {
  bridge.logError(error, options);
}

/** Log debug information
*/
export function logDebug(source: string, data: LoggableRecord): void {
  checkModuleScopedName(source);
  bridge.logDebug(source, data);
}

/** Flushes a log file. Returns when the flushing has been done, throws when the log did not exist
*/
function flushLog(logname: string | "*"): Promise<void> {
  return bridge.flushLog(logname);
}

export interface ReadLogOptions {
  start?: Date | null;
  limit?: Date | null;
}

function getDateFromLogFilename(filename: string) {
  const datetok = filename.split('.').at(-2)!; //! as we've already ensured the file ends in .YYYYMMDD.log
  return new Date(datetok.substring(0, 4) + "-" + datetok.substring(4, 6) + "-" + datetok.substring(6, 8));
}

type GenericLogFields = { [key: string]: LogReadField };
export type GenericLogLine = GenericLogFields & LogLineBase;

/** Read log lines from a specified log between the two given dates. Note that we ONLY support JSON encoded log lines */
export async function* readLogLines<LogFields = GenericLogFields>(logname: string, options?: ReadLogOptions): AsyncGenerator<LogFields & LogLineBase> {
  const [module, logfile] = checkModuleScopedName(logname);
  let fileinfo = getModuleDefinition(module).logs[logfile];
  if (!fileinfo) {
    if (module === "system" && logfile === "servicemanager") {
      fileinfo = {
        filename: "servicemanager",
        timestamps: false
      };
    } else
      throw new Error(`No such logfile '${logfile}' in module '${module}'`);
  } else {
    if (fileinfo.timestamps !== false)
      throw new Error(`Logfile '${logname}' must set timestamps to 'false' for readLogLines to be able to process it`);

    await flushLog(logname);
  }

  //TODO optimize. and do we need checkpoints or should callers just re-insert the last timestamp into 'start' ?
  const basedir = backendConfig.dataroot + "log";
  const filter = new RegExp("^" + escapeRegExp(fileinfo.filename + ".") + "[0-9]{8}\\.log$");
  const logfilenames = (await fs.readdir(basedir)).filter(_ => _.match(filter)).sort();

  for (const name of logfilenames) {
    const logfiledate = getDateFromLogFilename(name); //this is basically the time of the 'first' log entry
    //if the 'last' possible entry is before the start, skip this file
    if (options?.start && (logfiledate.getTime() + (86400 * 1000)) <= options.start.getTime())
      continue;

    //if the 'first' possible entry is past the limit, skip the file
    if (options?.limit && (logfiledate.getTime() > options.limit.getTime()))
      continue;

    //Okay, this one is in range. Start parsing
    const loglines = readFileSync(basedir + "/" + name, "utf8").split("\n");
    for (const line of loglines) {
      try {
        if (!(line.startsWith('{') && line.endsWith('}'))) //this won't be a valid logline, avoid the exception/parse attempt overhead
          continue;

        const parsedline = JSON.parse(line);
        parsedline["@timestamp"] = new Date(parsedline["@timestamp"]);
        if (!parsedline["@timestamp"] ||
          (options?.start && parsedline["@timestamp"].getTime() < options.start) ||
          (options?.limit && parsedline["@timestamp"].getTime() >= options.limit))
          continue;

        yield parsedline;
      } catch (e) {
        continue; //ignore unparseable lines
      }
    }
  }
}
