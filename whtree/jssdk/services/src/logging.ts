import bridge, { LogErrorOptions } from "@mod-system/js/internal/whmanager/bridge";

function replaceLogParts(key: string, value: unknown) {
  if (typeof value === "bigint") //is 'value' a BigInt?
    return value.toString();

  if (typeof value === "string" && value.length > 3000) //truncate too long strings
    return value.substring(0, 3000) + "… (" + value.length + " chars)";

  return value;
}

//exported for tests
export function formatLogObject(logline: object): string {
  return JSON.stringify({ "@timestamp": (new Date).toUTCString(), ...logline }, replaceLogParts);
}

/** Write a line to a log file
    @param logname - Name of the log file
    @param logline - Line to log - as string or as object (will have a \@timestamp added and be converted to JSON)
*/
export function log(logname: string, logline: string | object): void {
  if (typeof logline === "object")
    logline = formatLogObject(logline);

  bridge.log(logname, logline);
}

/** Log an error to the notice log
 * @param error - Error to log
 */
export function logError(error: Error, options?: LogErrorOptions): void {
  bridge.logError(error, options);
}

/** Flushes a log file. Returns when the flushing has been done, throws when the log did not exist
*/
export function flushLog(logname: string | "*"): Promise<void> {
  return bridge.flushLog(logname);
}
