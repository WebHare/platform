/**
 * Debugging tools for the MCP server: inspect running HareScript jobs through the debug manager,
 * eg to find out where a service or test is stuck and what it is waiting for.
 */
import { callJobDebugger } from "./jobdebuggerlib";
import { listLocks } from "@mod-platform/js/bridge/tools";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { profileTools, runProfileTool } from "./profiles";

export const listJobsToolName = "wh_debug_list_jobs";
export const jobStackToolName = "wh_debug_get_job_stack";
export const jobHandlesToolName = "wh_debug_get_job_handles";
export const listLocksToolName = "wh_debug_list_locks";

/** Default and maximum time to wait for a job to pause */
const defaultPauseTimeout = 5000;
const maxPauseTimeout = 30000;
/** Default and maximum nesting depth shown for record/object/array variables */
const defaultVariableDepth = 2;
const maxVariableDepth = 6;

interface DebugJob {
  processcode: string;
  groupid: string;
  script: string;
  status: string;
  creationdate: Date;
  runningmsecs: number;
  connected: boolean;
  contextinfo: string;
}

interface DebugVariable {
  name: string;
  value: string;
  members: DebugVariable[];
  truncated: boolean;
}

interface DebugJobStack {
  status: string;
  stacktrace: Array<{
    filename: string;
    func: string;
    line: number;
    col: number;
    hasvariables: boolean;
    variables: DebugVariable[];
    variableserror: string;
  }>;
}

interface DebugJobLock {
  processcode: string;
  name: string;
  groupid: string;
  script: string;
  waiting: boolean;
  lockposition: number;
  maxconcurrent: number;
  waitstart: Date;
  lockstart: Date;
}

const timeoutProperty = {
  type: "number",
  description: `Maximum time in milliseconds to wait for the job to pause (default ${defaultPauseTimeout}, max ${maxPauseTimeout})`
};

const jobTools: Tool[] = [
  {
    name: listJobsToolName,
    description: `List the HareScript jobs running in this WebHare, as shown by the HareScript debugger. `
      + `Returns each job's group id (needed by the other wh_debug_ tools), script, status, start time, time spent running and context info. `
      + `Services started as 'lib#Function' (eg the cluster services) run as 'wh::internal/asyncrunner.whscr' jobs, so use ${jobStackToolName} to tell them apart. `
      + `JavaScript processes are not included; use 'wh debug list-processes' for those.`,
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Only return jobs whose script, status, group id or context info contains this text (case insensitive)"
        }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: jobStackToolName,
    description: `Get the current stack trace of a running HareScript job, eg to find out where a script, service or test is stuck, `
      + `and optionally the local variables of some of its stack frames, eg to see which port, request or state it is waiting for. `
      + `The job is paused briefly and then continues. Get the group id from ${listJobsToolName}. `
      + `Fails if a debugger is already connected to the job.`,
    inputSchema: {
      type: "object",
      properties: {
        groupid: {
          type: "string",
          description: "Group id of the job"
        },
        variables: {
          type: "array",
          items: { type: "number" },
          description: "Indices of the stack frames (0 = innermost, as numbered in the output) to also show the local variables of. "
            + "Variables are read during the same pause as the stack trace, so frame numbers can't shift in between"
        },
        depth: {
          type: "number",
          description: `How deep to show the contents of records, objects and arrays (default ${defaultVariableDepth}, max ${maxVariableDepth}). `
            + `Long strings and large records/arrays are shortened by the debugger`
        },
        timeout: timeoutProperty
      },
      required: ["groupid"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  {
    name: jobHandlesToolName,
    description: `List the open handles of a running HareScript job: files, pipes, IPC links and ports, event streams and the like. `
      + `Useful to find out what a job may be waiting on, or to spot leaked handles. `
      + `The job is paused briefly and then continues. Get the group id from ${listJobsToolName}.`,
    inputSchema: {
      type: "object",
      properties: {
        groupid: {
          type: "string",
          description: "Group id of the job"
        },
        timeout: timeoutProperty
      },
      required: ["groupid"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  {
    name: listLocksToolName,
    description: `List the locks that are held or waited for in this WebHare, to find deadlocks or jobs blocked on a lock: `
      + `the cluster-wide mutexes (from the mutex manager, as used by eg the test framework) with their holders and waiters, `
      + `and the job locks inside each HareScript process. Database locks are not included.`,
    inputSchema: {
      type: "object",
      properties: {}
    },
    annotations: { readOnlyHint: true }
  }
];

function formatDuration(msecs: number): string {
  return msecs < 1000 ? `${msecs}ms` : `${(msecs / 1000).toFixed(1)}s`;
}

function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  const num = Number(value);
  return value !== undefined && Number.isFinite(num) ? Math.min(Math.max(Math.round(num), min), max) : defaultValue;
}

async function listJobs(filter: string): Promise<string> {
  const jobs = await callJobDebugger<DebugJob[]>("ListDebugJobs", filter);
  if (!jobs.length)
    return filter ? `No jobs match '${filter}'` : "No jobs found";

  jobs.sort((a, b) => a.script.localeCompare(b.script) || a.creationdate.getTime() - b.creationdate.getTime());
  const lines = jobs.map(job =>
    `- ${job.groupid}: ${job.script} [${job.status}${job.connected ? ", debugger connected" : ""}]`
    + ` started ${job.creationdate.toISOString()}, running ${formatDuration(job.runningmsecs)}, process ${job.processcode}`
    + (job.contextinfo ? `\n  context: ${job.contextinfo}` : ""));
  return `${jobs.length} job(s):\n${lines.join("\n")}`;
}

function formatVariables(vars: DebugVariable[], indent: string): string[] {
  const lines: string[] = [];
  for (const variable of vars) {
    lines.push(`${indent}${variable.name} = ${variable.value}${variable.truncated ? " (contents not shown, increase depth)" : ""}`);
    lines.push(...formatVariables(variable.members, indent + "  "));
  }
  return lines;
}

async function getJobStack(groupid: string, timeout: number, variableFrames: number[], depth: number): Promise<string> {
  const result = await callJobDebugger<DebugJobStack>("GetDebugJobStack", groupid, timeout, variableFrames, depth);
  if (!result.stacktrace.length)
    return `Job ${groupid} (${result.status}) has no stack trace`;

  const lines = [`Stack trace of job ${groupid} (${result.status}), innermost first:`];
  result.stacktrace.forEach((frame, idx) => {
    lines.push(`#${idx} ${frame.func} (${frame.filename}:${frame.line}:${frame.col})`);
    if (frame.variableserror)
      lines.push(`    variables unavailable: ${frame.variableserror}`);
    else if (frame.hasvariables)
      lines.push(...(frame.variables.length ? formatVariables(frame.variables, "    ") : ["    (no local variables)"]));
  });

  const missing = variableFrames.filter(idx => idx >= result.stacktrace.length);
  if (missing.length)
    lines.push(`Note: requested frame(s) ${missing.join(", ")} don't exist, the stack has ${result.stacktrace.length} frames`);
  return lines.join("\n");
}

async function getJobHandles(groupid: string, timeout: number): Promise<string> {
  const handles = await callJobDebugger<Array<{ name: string; id: number }>>("GetDebugJobHandles", groupid, timeout);
  if (!handles.length)
    return `Job ${groupid} has no open handles`;
  return `Open handles of job ${groupid}:\n${handles.map(handle => `- #${handle.id}: ${handle.name}`).join("\n")}`;
}

async function listAllLocks(): Promise<string> {
  const [mutexStatus, jobLocks] = await Promise.all([
    listLocks(),
    callJobDebugger<DebugJobLock[]>("ListDebugJobLocks")
  ]);

  const lines: string[] = [];
  const links = new Map(mutexStatus.links.map(link => [link.id, link]));
  const describeLink = (id: number) => {
    const link = links.get(id);
    return link ? `${link.clientname || "(unnamed)"}${link.groupid ? ` (job ${link.groupid})` : ""}` : `link #${id}`;
  };

  const taken = mutexStatus.mutexes.filter(mutex => mutex.taken || mutex.waiters);
  lines.push(taken.length ? "Cluster mutexes:" : "Cluster mutexes: none held");
  for (const mutex of taken)
    lines.push(`- ${mutex.mutexname}: ${mutex.taken ? `held by ${describeLink(mutex.takenby)}` : "not held"}${mutex.waiters ? `, ${mutex.waiters} waiting` : ""}`);

  const waiting = mutexStatus.links.filter(link => link.waiting);
  for (const link of waiting) {
    const year = link.waituntil.getFullYear();
    lines.push(`- ${describeLink(link.id)} is waiting for mutex '${link.waitfor}'${year > 1 && year < 9999 ? ` until ${link.waituntil.toISOString()}` : " (no deadline)"}`);
  }

  /* A cluster mutex first takes a process-local job lock named 'mutex:<name>', so jobs in the same process queue there before
     reaching the mutex manager. Those are only interesting if someone is waiting for them; otherwise they duplicate the list above */
  const localWaits = new Set(jobLocks.filter(lock => lock.waiting).map(lock => `${lock.processcode}\t${lock.name}`));
  const shownLocks = jobLocks.filter(lock => !lock.name.startsWith("mutex:") || localWaits.has(`${lock.processcode}\t${lock.name}`));
  const hiddenLocks = jobLocks.length - shownLocks.length;

  lines.push(shownLocks.length ? "\nHareScript job locks (within a process):" : "\nHareScript job locks: none held or waited for");
  for (const lock of shownLocks)
    lines.push(`- ${lock.name} in process ${lock.processcode}: ${lock.waiting ? `waiting since ${lock.waitstart.toISOString()}` : `held since ${lock.lockstart.toISOString()}`}`
      + ` by job ${lock.groupid}${lock.script ? ` (${lock.script})` : ""}, queue position ${lock.lockposition}`);
  if (hiddenLocks)
    lines.push(`(${hiddenLocks} process-local 'mutex:' lock(s) not shown: they are the local side of the cluster mutexes above and nobody is waiting for them locally)`);

  return lines.join("\n");
}

export const debugTools: Tool[] = [...jobTools, ...profileTools];

/** Run a debug tool. Returns null if the tool isn't a debug tool */
export async function runDebugTool(name: string, args: Record<string, unknown> | undefined): Promise<string | null> {
  switch (name) {
    case listJobsToolName:
      return await listJobs(args?.filter ? String(args.filter) : "");

    case jobStackToolName:
    case jobHandlesToolName: {
      if (!args?.groupid)
        throw new Error("Missing groupid");
      const groupid = String(args.groupid);
      const timeout = clampNumber(args.timeout, defaultPauseTimeout, 1, maxPauseTimeout);
      if (name === jobHandlesToolName)
        return await getJobHandles(groupid, timeout);

      const variableFrames = Array.isArray(args.variables) ? args.variables.map(Number).filter(idx => Number.isInteger(idx) && idx >= 0) : [];
      const depth = clampNumber(args.depth, defaultVariableDepth, 0, maxVariableDepth);
      return await getJobStack(groupid, timeout, variableFrames, depth);
    }

    case listLocksToolName:
      return await listAllLocks();
  }
  return await runProfileTool(name, args);
}
