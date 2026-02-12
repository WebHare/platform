import bridge, { type LogErrorOptions, type LogNoticeOptions } from "@mod-system/js/internal/whmanager/bridge";
import type { LoggableRecord } from "./logmessages";
import { backendConfig } from "./config.ts";
import type { LogFormats } from "./services.ts";
import { WebHareBlob } from "./webhareblob.ts";
import { checkModuleScopedName } from "./naming";
import { getModuleDefinition } from "./moduledefinitions";
import { convertFlexibleInstantToDate, escapeRegExp, isBlob, stringify, type FlexibleInstant } from "@webhare/std";
import type { HTTPMethod, HTTPStatusCode } from "@webhare/router";
import { listDirectory } from "@webhare/system-tools";
import path from "node:path";
import { runInSeparateWork } from "@webhare/whdb";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { getRegistryKeyEventMasks, readRegistryKey, writeRegistryKey } from "./registry.ts";
import { LocalCache } from "./localcache.ts";

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
  method: keyof HTTPMethod | string; //keyof HTTPMethod to add common methods directly to intellisense
  /** Full request URL */
  url: string;
  /** Response status code (eg. 200 = Ok) */
  statusCode: HTTPStatusCode | number; //keyof statusCode to add common codes directly to intellisense
  /** Number of bytes sent in the response body */
  bodySent?: number;
  /** Number of bytes received in the request body */
  bodyReceived?: number;
  /** Referrer URL (from 'referer' header) */
  referrer?: string;
  /** Browser User-Agent string */
  userAgent?: string;
  /** Mime type of the response */
  mimeType?: string;
  /** Time between full receipt of the request and the start of the response in seconds */
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

type RPCLogRegistryKeyValue = {
  loguntil: Date | null;
  profileuntil?: Date | null;
};

async function getCachableRPCLogStatus(logtype: string, options?: { autoEnable?: boolean }) {
  const keyName = `system.logging.rpc.${logtype.replace(".", "_")}`;
  let logSetting = await readRegistryKey<RPCLogRegistryKeyValue | null>(keyName, null, { acceptInvalidKeyNames: true });
  if (!logSetting) {
    // Run in separate work to avoid interference with open work.
    await runInSeparateWork(async () => {
      // Reread the setting in case it was created while we were waiting for the mutex
      logSetting = await readRegistryKey<RPCLogRegistryKeyValue | null>(keyName, null, { acceptInvalidKeyNames: true });
      if (!logSetting) {
        logSetting = {
          loguntil: options?.autoEnable ? maxDateTime : defaultDateTime,
        };
        await writeRegistryKey(keyName, logSetting, { acceptInvalidKeyNames: true, createIfNeeded: true });
      }
    }, { mutex: "system:rpclogstatus" });
    if (!logSetting)
      throw new Error("Failed to get or create RPC log status");
  }

  const now = Date.now();
  if (!logSetting?.loguntil || logSetting.loguntil.getTime() <= now)
    logSetting.loguntil = null;
  if (!logSetting?.profileuntil || logSetting.profileuntil.getTime() <= now)
    logSetting.profileuntil = null;

  return {
    value: logSetting,
    masks: getRegistryKeyEventMasks([keyName]),
  };
}

const rpcLogStatusCache = new LocalCache<{ loguntil: Date | null; profileuntil?: Date | null }>();

export async function logRPCTraffic(
  logSource: string,
  transport: string,
  direction: "incoming" | "outgoing",
  data: unknown,
  options?: {
    sourceTracker?: string;
    transactionId?: string;
  }) {
  checkModuleScopedName(logSource);
  if (!transport)
    throw new Error("A transport must be specified");

  const logStatus = await rpcLogStatusCache.get(logSource, () => getCachableRPCLogStatus(logSource));
  if (!logStatus.loguntil || logStatus.loguntil.getTime() <= Date.now()) {
    return;
  }

  data = typeof data === "function" ? await data() : data; //allow lazy evaluation of log data to avoid expensive calculations when logging is disabled
  console.dir({ logSource, transport, direction, data, options }, { depth: null });

  let encodedData = stringify(typeof data === "function" ? await data() : data, { typed: true });
  const byteLength = Buffer.byteLength(encodedData, "utf-8");
  if (byteLength > 128 * 1024)
    encodedData = JSON.stringify({ __notlogged: `Not logging ${byteLength} bytes of encoded data` }); //we can't throw, it would often break RPCs

  bridge.logRaw("system:rpc",
    JSON.stringify(logSource) + "\t" +
    JSON.stringify(bridge.getGroupId()) + "\t\t" +
    JSON.stringify(options?.sourceTracker || "-") +
    (direction === "outgoing" ? "\t>" : "\t<") +
    JSON.stringify(transport) + "\t" +
    JSON.stringify(options?.transactionId || "-") + "\t" +
    encodedData);
}

export interface ReadLogOptions {
  start?: FlexibleInstant | null;
  limit?: FlexibleInstant | null;
  content?: string | Blob;
  /** Override where to find the log files. Usually of the form `/tmp/logfiles/pxl` to which the reader will append `.<DATE>.log`  */
  basePath?: string;
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

    if (!options?.basePath)
      await bridge.flushLog(logname);
  }

  //TODO optimize. and do we need checkpoints or should callers just re-insert the last timestamp into 'start' ?
  const basePath = options?.basePath || `${backendConfig.dataRoot}log/${fileinfo.filename}`;
  const filter = new RegExp("^" + escapeRegExp(path.basename(basePath) + ".") + "[0-9]{8}\\.log$");
  const logfiles = (await listDirectory(path.dirname(basePath), { allowMissing: true })).filter(_ => _.name.match(filter)).sort();
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
