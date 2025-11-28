/// Expected format for log lines. We can't really specify types, some loggers might not know it either (eg. if they're logging external RPC responses)
export type LoggableRecord = { [key: string]: unknown };

function replaceLogParts(key: string, value: unknown) {
  //Keep logs readable, try not to miss anything. But make sure we still output valid JSON
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "symbol":
      return `[${value.toString()}]`;
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "string":
      if (value.length > 3000) //truncate too long strings
        return value.substring(0, 3000) + "… (" + value.length + " chars)";
    //fallthrough
  }
  return value;
}

///Create a string logline, order timestamp to front
export function formatLogObject(when: Date | string | null, logline: LoggableRecord): string {
  if (when) {
    const timestamp = typeof when === "string" ? when : when.toISOString();
    logline = { "@timestamp": timestamp, ...logline };
  }
  return JSON.stringify(logline, replaceLogParts);
}
