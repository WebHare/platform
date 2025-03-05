import { toFSPath } from "@webhare/services/src/resources.ts";
import type { HSVMVar } from "./wasm-hsvmvar";

export const HSVMSymbol = Symbol("HSVM");

export function mapHareScriptPath(uri: string | null) {
  if (!uri)
    return "unknown";

  //Legacy HareScript namespaces we may not want to retain in JS
  if (uri.startsWith("direct::"))
    return uri.substring(8);

  if (uri.startsWith("wh::"))
    return toFSPath("mod::system/whlibs/" + uri.substring(4));

  return toFSPath(uri, { keepUnmatched: true });
}

export type ExceptionTrace = Array<{
  filename: string;
  line: number;
  col: number;
  func: string;
}>;

export function prependHSStackTrace(e: Error, trace: ExceptionTrace) {
  const tracelines = trace.map(traceItem => `    at ${traceItem.func} (${traceItem.filename}:${traceItem.line}:${traceItem.col})\n`).join("");
  const currStack = e.stack || e.message;
  const firstAt = currStack.indexOf("\n    at ") + 1 || currStack.length;
  e.stack = currStack.slice(0, firstAt) + tracelines + currStack.slice(firstAt);
  return e;
}

export function parseHSException(value: HSVMVar) {
  if (!value)
    return new Error("Unknown error");
  const message = value.getMemberRef("WHAT", { allowMissing: true })?.getString();
  const stack = (value.getMemberRef("PVT_TRACE", { allowMissing: true })?.getJSValue() ?? []) as ExceptionTrace;

  return prependHSStackTrace(new Error(message ?? "Unknown error"), stack);
}
