import bridge, { type LogErrorOptions, type LogNoticeOptions } from "@mod-system/js/internal/whmanager/bridge";
import type { LoggableRecord } from "./logmessages";
import { backendConfig } from "./config.ts";
import type { LogFormats } from "./services.ts";
import { WebHareBlob } from "./webhareblob.ts";
import { checkModuleScopedName } from "./naming";
import { getModuleDefinition } from "./moduledefinitions";
import { convertFlexibleInstantToDate, escapeRegExp, isBlob, type FlexibleInstant } from "@webhare/std";
import type { HTTPMethod, HTTPStatusCode } from "@webhare/router";
import { listDirectory } from "@webhare/system-tools";

type LogReadField = string | number | boolean | null | Temporal.Instant | LogReadField[] | { [key: string]: LogReadField };
type LogLineBase = {
  /** Log line's timestap */
  "@timestamp": Temporal.Instant;
  /** ID of this logline (unique inside a logtype but not a logfile) which allows us to resume reading.
   *
   * This is currently formatted as `A<date>:<offset>` but you shouldn't rely on that format always staying the same.
   */
  "@id": string;
};

/** Webserver access log lines
 */
export type AccessLogLine = LogLineBase & {
  ip: string;
  user?: string;
  /** Request method */
  method: keyof HTTPMethod | string; //add most common methods
  url: string;
  statusCode: HTTPStatusCode | number; //add most common statuscodes
  bodySent?: number;
  bodyReceived?: number;
  referrer?: string;
  userAgent?: string;
  mimeType?: string;
  responseTime?: number;
};

/** Webserver PXL log
 *  This logfile is currently just a subset of the access log with field that may not be supported in the future removed (ie if we want to POST large/multiple pxls together)
 */
export type PxlLogLine = LogLineBase & Pick<AccessLogLine, "ip" | "user" | "url" | "referrer" | "userAgent">;

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
  start?: FlexibleInstant | null;
  limit?: FlexibleInstant | null;
  content?: string | Blob;
  /** Continu reading loglines after the line with this id */
  continueAfter?: string;
}

type GenericLogFields = { [key: string]: LogReadField | undefined };
export type GenericLogLine = GenericLogFields & LogLineBase;

export function readLogLines<LogFormat extends keyof LogFormats>(logname: LogFormat, options?: ReadLogOptions): AsyncGenerator<LogFormats[LogFormat] & LogLineBase>;
export function readLogLines<LogFields = GenericLogFields>(logname: string, options?: ReadLogOptions): AsyncGenerator<LogFields & LogLineBase>;

/** Read log lines from a specified log between the two given dates. Note that we ONLY support JSON encoded log lines */
export async function* readLogLines<LogFields = GenericLogFields>(logname: string, options?: ReadLogOptions): AsyncGenerator<LogFields & LogLineBase> {
  const [module, logfile] = checkModuleScopedName(logname);
  let fileinfo = getModuleDefinition(module).logs[logfile];
  if (!fileinfo) {
    if (module === "platform" && ["servicemanager", "access", "pxl"].includes(logfile)) { // 'builtin' logs
      fileinfo = {
        filename: logfile,
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
  const basedir = backendConfig.dataRoot + "log";
  const filter = new RegExp("^" + escapeRegExp(fileinfo.filename + ".") + "[0-9]{8}\\.log$");
  const logfiles = (await listDirectory(basedir, { allowMissing: true })).filter(_ => _.name.match(filter)).sort();
  const start = options?.start ? convertFlexibleInstantToDate(options.start) : null;
  const limit = options?.limit ? convertFlexibleInstantToDate(options.limit) : null;

  for (const file of logfiles) {
    const datetok = file.name.split('.').at(-2)!; //... as we've already ensured the file ends in .YYYYMMDD.log
    const textdate = datetok.substring(0, 4) + "-" + datetok.substring(4, 6) + "-" + datetok.substring(6, 8);
    const logfiledate = new Date(textdate);

    //if the 'last' possible entry is before the start, skip this file
    if (start && (logfiledate.getTime() + (86400 * 1000)) <= start.getTime())
      continue;

    if (options?.continueAfter && options?.continueAfter.split(':')[0] > `A${datetok}:`) //An id/continuation point was given and it's not in this file
      continue;

    //if the 'first' possible entry is past the limit, skip the file
    if (limit && (logfiledate.getTime() > limit.getTime()))
      continue;

    const continueAfterOffset: number = options?.continueAfter?.split(':')[0] === `A${datetok}` ? parseInt(options?.continueAfter.split(':')[1], 10) : -1;

    // Offset of the current processed chunk, and if this chunk starts at the beginning of a line
    let curChunkStart = Math.max(0, continueAfterOffset);
    let atLineStart = continueAfterOffset < 0;

    // Get the data, slice it so it starts at curChunkStart
    const fullDataBlob = (options?.content ? isBlob(options.content) ? options.content : WebHareBlob.from(options.content) : await WebHareBlob.fromDisk(file.fullPath));
    const dataBlob = fullDataBlob.slice(curChunkStart);

    let leftOver: Uint8Array<ArrayBufferLike> | undefined;
    const textDecoder = new TextDecoder("utf8");

    for await (const chunk of dataBlob.stream()) {
      let localOfs = 0;

      if (!atLineStart) {
        // find the end of the current line
        const firstLineFeed = chunk.indexOf(10);
        if (firstLineFeed === -1) {
          // no line feed in this chunk, continue with the next chunk
          curChunkStart += chunk.length;
          continue;
        } else {
          // got a line. INV: leftOver = undefined
          localOfs = firstLineFeed + 1;
          atLineStart = true;
        }
      }

      // find lines in current chunk
      for (; ;) {
        // Find the end of the current line
        const nextLineFeed = chunk.indexOf(10, localOfs);
        if (nextLineFeed === -1)
          break;

        // get the line data and decode it. Also calculate the file offset where the line started
        const part = chunk.slice(localOfs, nextLineFeed);
        const line = textDecoder.decode(leftOver ? Buffer.concat([leftOver, part]) : part);
        const lineOffset = curChunkStart + localOfs - (leftOver ? leftOver.length : 0);

        // Prepare for reading the next line before processing this one
        localOfs = nextLineFeed + 1;
        leftOver = undefined;

        try {
          if (continueAfterOffset && lineOffset <= continueAfterOffset) //we're not there yet
            continue;

          if (!(line.startsWith('{') && line.endsWith('}'))) //this won't be a valid logline, avoid the exception/parse attempt overhead
            continue;

          const parsedline = JSON.parse(line) as GenericLogFields;
          if (typeof parsedline["@timestamp"] !== 'string')
            continue;

          const timestamp = Temporal.Instant.from(parsedline["@timestamp"]);
          if (!timestamp || (start && timestamp.epochMilliseconds < start.getTime()) || (limit && timestamp.epochMilliseconds >= limit.getTime()))
            continue;

          /* The ID needs to be usable as a unique identifier inside this log type but also be ascii sortable so we can easily find the most recently
             stored record (by sorting by ID in descending order and taking the first. So we're padding ID to be 15 in length (the length of MAX_SAFE_INTEGER)
             to make is ascii sortable. We're prefixing with 'A' so any future improved algorithm can use 'B' and sort after us */
          const id = `A${datetok}:${String(lineOffset).padStart(15, '0')}`;
          yield { ...parsedline, ["@id"]: id, ["@timestamp"]: timestamp } as LogFields & LogLineBase;
        } catch (e) {
          continue; //ignore unparseable lines
        }
      }

      // Store the leftover data of the chunk for the next iteration
      leftOver = leftOver ? Buffer.concat([leftOver, chunk.slice(localOfs)]) : chunk.slice(localOfs);
      curChunkStart += chunk.length;
    }
  }
}
