/* Stack traces with the local variables of a paused job */

import type { HSDebugJob } from "./client";
import type { DebugJobStatus, DebugStackFrame, RawDebugValue } from "./protocol";
import { isContainerValue, renderVariable, type RenderedVariable } from "./variables";

/** Maximum number of items/cells to retrieve per record, object or array */
const maxItemsPerContainer = 50n;

export interface StackFrameWithVariables {
  filename: string;
  func: string;
  line: number;
  col: number;
  /** Whether variables were retrieved for this frame */
  hasVariables: boolean;
  variables: RenderedVariable[];
  /** Why variables couldn't be retrieved, if requested */
  variablesError: string;
}

export interface JobStackOptions {
  /** Indices of the frames (0 = innermost) to get the variables of */
  variableFrames?: number[];
  /** Maximum depth to show records, objects and arrays */
  maxDepth?: number;
  /** Maximum number of extra requests to retrieve more of large values */
  expansionBudget?: number;
}

/** Retrieve more of a value, the way the debugger screen does when a node is expanded: the job only sends one level of
    nested values, so containers deeper down arrive with 'max' below 'length' */
async function expandValue(job: HSDebugJob, value: RawDebugValue, depth: number, maxDepth: number, budget: { remaining: number }): Promise<RawDebugValue> {
  if (!isContainerValue(value) || depth >= maxDepth)
    return value;

  if (value.length !== undefined && value.max !== undefined && value.max < value.length && value.max < maxItemsPerContainer && budget.remaining > 0) {
    --budget.remaining;
    const max = value.length < maxItemsPerContainer ? value.length : maxItemsPerContainer;
    const [expanded] = await job.getVariables([{ id: value.id, max }]);
    if (expanded && expanded.type === value.type)
      value = expanded;
  }

  if (!Array.isArray(value.value))
    return value;

  const isArray = value.type >= 0x80;
  const items = value.value as unknown[];
  const newItems = [];
  for (const item of items) {
    if (isArray)
      newItems.push(await expandValue(job, item as RawDebugValue, depth + 1, maxDepth, budget));
    else if (item && typeof item === "object" && "value" in item && (item as { value: unknown }).value)
      newItems.push({ ...item, value: await expandValue(job, (item as { value: RawDebugValue }).value, depth + 1, maxDepth, budget) });
    else
      newItems.push(item);
  }
  return { ...value, value: newItems };
}

/** Get the variables of a stack frame of a paused job */
export async function getFrameVariables(job: HSDebugJob, frame: DebugStackFrame, { maxDepth = 2, budget = { remaining: 200 } }: { maxDepth?: number; budget?: { remaining: number } } = {}): Promise<RenderedVariable[]> {
  if (frame.codeptr === undefined || frame.codeptr < 0)
    throw new Error(frame.codeptr === -1 ? "No variables available for external (native) functions" : "Stack frame has been unwound");

  const info = await job.getDebugInfo(frame.filename);
  const vars = info.getFrameVariables(frame.codeptr, frame.baseptr);
  if (!vars.length)
    return [];

  const values = await job.getVariables(vars.map(v => ({ id: v.id })));
  const result: RenderedVariable[] = [];
  for (const [idx, variable] of vars.entries()) {
    const expanded = await expandValue(job, values[idx], 0, maxDepth, budget);
    result.push(renderVariable(variable.name, expanded, maxDepth));
  }
  return result;
}

/** Get the stack trace (and optionally variables) of a paused job
    @param job - Paused job
    @param status - Status returned when the job paused
*/
export async function getJobStack(job: HSDebugJob, status: DebugJobStatus, { variableFrames = [], maxDepth = 2, expansionBudget = 200 }: JobStackOptions = {}): Promise<StackFrameWithVariables[]> {
  const budget = { remaining: expansionBudget };
  const frames: StackFrameWithVariables[] = [];
  for (const [idx, frame] of (status.stacktrace ?? []).entries()) {
    const outframe: StackFrameWithVariables = {
      filename: frame.filename ?? "",
      func: frame.func ?? "",
      line: frame.line ?? 0,
      col: frame.col ?? 0,
      hasVariables: false,
      variables: [],
      variablesError: ""
    };
    if (variableFrames.includes(idx)) {
      try {
        outframe.variables = await getFrameVariables(job, frame, { maxDepth, budget });
        outframe.hasVariables = true;
      } catch (e) {
        outframe.variablesError = (e as Error).message;
      }
    }
    frames.push(outframe);
  }
  return frames;
}
