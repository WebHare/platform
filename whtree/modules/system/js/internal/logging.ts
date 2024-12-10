import { readLogLines } from "@webhare/services";
import { GenericLogLine } from "@webhare/services/src/logging";

/** @deprecated This API is intended for use by HareScript only */
export async function readJSONLogLines(name: string, since: Date, limit: Date | null = null): Promise<GenericLogLine[]> {
  const lines = [];
  for await (const val of readLogLines(name, { start: since, limit })) {
    lines.push(val);
  }
  return lines;
}
