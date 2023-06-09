import { readLogLines } from "@webhare/services";
import { GenericLogLine } from "@webhare/services/src/logging";

export async function readRecentLogLines(name: string, since: Date): Promise<GenericLogLine[]> {
  const lines = [];
  for await (const val of readLogLines(name, { start: since, limit: new Date(Date.now() + 1) })) {
    lines.push(val);
  }
  return lines;
}
