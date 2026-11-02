import bridge, { type LogErrorOptions, type LogNoticeOptions } from "@mod-system/js/internal/whmanager/bridge";
import type { LoggableRecord } from "./logmessages";
import { parseModuleQualifiedName, type ModuleQualifiedName } from "./naming";

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

type CheckModuleQualified<T extends string> = T extends Lowercase<ModuleQualifiedName> ? T : "Must be a lowercase module qualified name";

/** Log debug information
 * @param source - Source in `modulename:debugtag` format
 * @param data - Data to log. Must be JSON-serializable
*/
export function logDebug<T extends string>(source: CheckModuleQualified<T>, data: LoggableRecord): void {
  parseModuleQualifiedName(source);
  bridge.logDebug(source, data);
}
