export type StackTraceItem = {
  filename: string;
  line: number;
  col: number;
  func: string;
};

function getRawStackTrace(): NodeJS.CallSite[] {
  const old_func = Error.prepareStackTrace;
  let capturedframes: NodeJS.CallSite[] = [];
  Error.prepareStackTrace = (error: Error, frames: NodeJS.CallSite[]) => {
    capturedframes = frames;
    old_func?.(error, frames);
  };
  void ((new Error).stack);
  Error.prepareStackTrace = old_func;
  return capturedframes;
}

function mapCallSite(frame: NodeJS.CallSite): StackTraceItem {
  if (!frame) {
    return {
      filename: "unknown",
      line: 1,
      col: 1,
      func: "unknown"
    };
  }

  return ({
    filename: frame.getFileName() || "unknown",
    line: frame.getLineNumber() || 1,
    col: frame.getColumnNumber() || 1,
    func: frame.getFunctionName() || "unknown"
  });
}

/** Returns the location of the caller
 * @param depth - Depth of the stack trace. 0 is own location, 1 of parent, etc.
 */
export function getCallerLocation(depth: number): StackTraceItem {
  const res = mapCallSite(getRawStackTrace()[depth + 2]);
  return res;
}

export function getCallStack(depth: number) {
  return getRawStackTrace().slice(2 + depth).map(f => mapCallSite(f));
}

export function getCallStackAsText(depth: number) {
  return getRawStackTrace().slice(2 + depth).map(f => mapCallSite(f)).map(i => `${i.filename}:${i.line}:${i.col} (${i.func})`).join('\n');
}
