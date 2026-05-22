import { getStackTrace } from "@webhare/js-api-tools/src/stacktracing";

export function decodePostgreSQLWHLogInfo(logline: string): {
  debuginfo: string;
  debuginfohint: string;
  debuginfotrace: { filename: string; line: number; col: number; func: string }[];
} {
  const retval = {
    debuginfo: "",
    debuginfohint: "",
    debuginfotrace: [] as { filename: string; line: number; col: number; func: string }[],
  };

  const r = new RegExp("^([^#]*)#([0-9]*)#([0-9]*)\\(([^)]*)\\)$");
  switch (logline.charAt(0)) {
    case "t": {
      const parts = logline.substring(2, logline.length - 1).split(",");
      retval.debuginfo = parts.find(p => p !== "mod::system/lib/database.whlib" && !p.startsWith("wh::dbase/") && !p.startsWith("wh::internal/trans")) ?? "";
      retval.debuginfohint = "Stack trace:\n" + parts.join("\n");
      for (const p of parts) {
        const matches = r.exec(p);
        if (matches) {
          retval.debuginfotrace.push({
            filename: matches[1],
            line: parseInt(matches[2], 10) || 1,
            col: parseInt(matches[3], 10) || 1,
            func: matches[4],
          });
        }
      }
      break;
    }
  }

  return retval;
}

export function buildLogInfoPrefix(): string {
  if (Error.stackTraceLimit < 20) // default 10 is not enough, kysely can fill it by itself
    Error.stackTraceLimit = 20;
  const trace = getStackTrace();
  const lastOmitIdx = trace.findLastIndex(_ => _.filename?.includes("/node_modules/kysely/") || _.filename?.includes("/jssdk/whdb/src/"));
  return `/*whlog:t[${trace.slice(lastOmitIdx + 1, lastOmitIdx + 17).map(_ => `${_.filename}#${_.line}#${_.col}(${_.func})`).join(",")}]*/`;
}
