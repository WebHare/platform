import * as stacktrace_parser from "stacktrace-parser";

export type StackTraceItem = {
  filename: string;
  line: number;
  col: number;
  func: string;
};

export type StackTrace = StackTraceItem[];

export function parseTrace(e: Error): StackTrace {
  if (!e?.stack)
    return [];

  const trace = stacktrace_parser.parse(e.stack);
  return trace.map(i => ({ filename: i.file || "", line: i.lineNumber || 1, col: i.column || 1, func: (i.methodName || "") }));
}

export function getStackTrace(): StackTrace {
  return parseTrace(new Error()).slice(1);
}

export function formatTrace(trace: StackTraceItem[]): string {
  return trace.map(e =>
    `    at ${e.func} (${e.filename}:${e.line}:${e.col})`).join("\n");
}

export function prependStackTrace(error: Error, trace: StackTrace) {
  if (!error.stack)
    return; //no stack to manipulate

  const stacklines = error.stack?.split("\n") || [];
  const tracelines = formatTrace(trace);
  error.stack = (stacklines[0] ? stacklines[0] + "\n" : "") + tracelines + '\n' + (stacklines.slice(1).join("\n"));
  return error;
}
