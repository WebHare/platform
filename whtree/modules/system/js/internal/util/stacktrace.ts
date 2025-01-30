import { fileURLToPath } from "node:url";
import Module from "node:module";
import type { StackTraceItem } from "@webhare/js-api-tools";
export type { StackTraceItem };

/* this api takes over source mapping of an entire stack trace, so getCallerLocation only needs to
   do one source map lookup (accelerating logging for console log)
   ADDME: test if this is really worth it comparing to parsing Error.stack with stacktrace-parser
*/

function getRawStackTrace(): NodeJS.CallSite[] {
  let capturedframes: NodeJS.CallSite[] = [];

  const old_func = Error.prepareStackTrace;
  Error.prepareStackTrace = (error: Error, frames: NodeJS.CallSite[]) => {
    capturedframes = frames;
    old_func?.(error, frames);
  };
  void ((new Error).stack);
  Error.prepareStackTrace = old_func;
  return capturedframes;
}

let lastFileName: string | undefined;
let lastSourceMap: Module.SourceMap | undefined;

function unknownStackTraceItem() {
  return {
    filename: "unknown",
    line: 1,
    col: 1,
    func: "unknown"
  };
}

function mapCallSite(t: NodeJS.CallSite): StackTraceItem {
  if (!t)
    return unknownStackTraceItem();

  // Adapted from node:internal/source_map/prepare_stack_trace

  const fileName = t.getFileName() ?? t.getEvalOrigin();
  if (!fileName)
    return unknownStackTraceItem();

  const sm = fileName === lastFileName ?
    lastSourceMap :
    Module.findSourceMap(fileName);
  lastSourceMap = sm;
  lastFileName = fileName;
  if (sm) {

    // Source Map V3 lines/columns start at 0/0 whereas stack traces
    // start at 1/1:
    const {
      originalLine,
      originalColumn,
      originalSource,
    } = sm.findEntry((t.getLineNumber() ?? 1) - 1, (t.getColumnNumber() ?? 1) - 1);

    if (originalSource && originalLine !== undefined &&
      originalColumn !== undefined) {
      const name = getOriginalSymbolName(sm, t);
      // Construct call site name based on: v8.dev/docs/stack-trace-api:
      const fnName = t.getFunctionName() ?? t.getMethodName();
      const typeName = t.getTypeName();
      const namePrefix = typeName !== null && typeName !== 'global' ? `${typeName}.` : '';
      const originalName = `${namePrefix}${fnName || '<anonymous>'}`;
      // The original call site may have a different symbol name
      // associated with it, use it:
      const prefix = (name && name !== originalName) ?
        `${name}` :
        `${originalName}`;
      const originalSourceNoScheme = originalSource.startsWith('file://')
        ? fileURLToPath(originalSource)
        : originalSource;
      return {
        filename: originalSourceNoScheme,
        line: originalLine + 1,
        col: originalColumn + 1,
        func: prefix ?? "unknown"
      };
    }
  }
  return ({
    filename: t.getFileName() || "unknown",
    line: t.getLineNumber() || 1,
    col: t.getColumnNumber() || 1,
    func: t.getFunctionName() || "unknown"
  });
}

// Adapted from node:internal/source_map/prepare_stack_trace
function getOriginalSymbolName(sourceMap: Module.SourceMap, t: NodeJS.CallSite): string | undefined {
  if (!("getEnclosingLineNumber" in t))
    return;

  // Node 19.7 has getEnclosingLineNumber and getEnclosingColumnNumber in CallSiteJS, but those aren't declared in NodeJS.CallSite yet
  const t_e = t as NodeJS.CallSite & { getEnclosingLineNumber(): number; getEnclosingColumnNumber(): number };

  // First check for a symbol name associated with the enclosing function: (name isn't declared on Module.SourceMapping, but is actually present)
  const enclosingEntry = sourceMap.findEntry(
    t_e.getEnclosingLineNumber() - 1,
    t_e.getEnclosingColumnNumber() - 1,
  ) as Module.SourceMapping & { name?: string };
  if (enclosingEntry.name)
    return enclosingEntry.name;

  // nodejs has fallback to name of the next entry (if it has the same filename), but we don't have that context here
}

/** Returns the location of the caller
 * @param depth - Depth of the stack trace. 0 is own location, 1 of parent, etc.
 */
export function getCallerLocation(depth: number): StackTraceItem {
  const res = mapCallSite(getRawStackTrace()[depth + 2]);
  return res;
}

export function getCallStack(depth: number): StackTraceItem[] {
  return getRawStackTrace().slice(2 + depth).map(f => mapCallSite(f));
}

export function getCallStackAsText(depth: number): string {
  return callStackToText(getRawStackTrace().slice(2 + depth).map(f => mapCallSite(f)));
}

export function callStackToText(callstack: StackTraceItem[]): string {
  return callstack.map(i => `${i.filename}:${i.line}:${i.col} (${i.func})`).join('\n');
}
