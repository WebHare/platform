/* HareScript debug agent: offers the HareScript debugger over a stream (usually stdin/stdout, see `wh debug harescript-agent`),
   so a debugger running elsewhere can debug this WebHare, eg one in a container or on another machine:

     podman exec -i <container> wh debug harescript-agent
     ssh <host> wh debug harescript-agent

   The protocol is JSON-RPC 2.0, one message per line, with the value encoding of wire.ts. Requests are answered in the
   order they complete. Notifications sent by the agent:
   - jobStatus { groupid, status }: the status of an attached job changed (eg it paused at a breakpoint)
   - jobDetached { groupid }: an attached job was detached (eg because it terminated)
*/

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { backendConfig, toFSPath } from "@webhare/services";
import { HSDebugConnection, durationToMsecs, type HSDebugJob } from "./client";
import { JobBreakpoints, type LineBreakpointRequest, type StepKind } from "./breakpoints";
import { getFrameVariables, getJobStack } from "./stack";
import { listStoredProfileSessions, listStoredProfiles, profileJob, readStoredProfile } from "./profiles";
import { renderVariable } from "./variables";
import { decodeWire, encodeWire } from "./wire";
import type { GetVariablesRequest } from "./protocol";

export const agentProtocolVersion = 1;

interface AttachedJob {
  job: HSDebugJob;
  breakpoints: JobBreakpoints;
  removeListener: () => void;
}

type Params = Record<string, unknown>;

/** Implements the agent's methods on a debug manager connection */
export class HSDebugAgent {
  private readonly conn: HSDebugConnection;
  private readonly notify: (method: string, params: unknown) => void;
  private attached = new Map<string, AttachedJob>();

  constructor(conn: HSDebugConnection, notify: (method: string, params: unknown) => void) {
    this.conn = conn;
    this.notify = notify;
  }

  private getAttached(groupid: unknown): AttachedJob {
    const entry = this.attached.get(String(groupid));
    if (!entry)
      throw new Error(`Not attached to job '${String(groupid)}'`);
    return entry;
  }

  private requirePaused(entry: AttachedJob) {
    if (!entry.job.paused)
      throw new Error(`Job '${entry.job.groupid}' isn't paused`);
  }

  async call(method: string, params: Params): Promise<unknown> {
    switch (method) {
      case "hello":
        return { version: agentProtocolVersion, serverName: backendConfig.serverName, installationRoot: backendConfig.installationRoot, dataRoot: backendConfig.dataRoot };

      case "listProcesses":
        return await this.conn.listProcesses();

      case "listJobs": {
        const needle = String(params.filter ?? "").toLowerCase();
        return (await this.conn.listAllJobs())
          .map(job => ({ ...job, runningMsecs: durationToMsecs(job.total_running) }))
          .filter(job => !needle || `${job.script}\t${job.status}\t${job.groupid}`.toLowerCase().includes(needle));
      }

      case "getLocks":
        return await this.conn.getLocks(BigInt(params.processcode as bigint));

      case "attach": {
        const groupid = String(params.groupid);
        if (this.attached.has(groupid))
          return this.attached.get(groupid)!.job.status;
        const job = await this.conn.attach(groupid);
        const removeListener = job.addStatusListener(status => {
          if (status)
            this.notify("jobStatus", { groupid, status });
          else {
            this.attached.delete(groupid);
            this.notify("jobDetached", { groupid });
          }
        });
        this.attached.set(groupid, { job, breakpoints: new JobBreakpoints(job), removeListener });
        return job.status;
      }

      case "detach": {
        const entry = this.attached.get(String(params.groupid));
        if (entry) {
          entry.removeListener();
          this.attached.delete(entry.job.groupid);
          entry.job.detach();
        }
        return null;
      }

      case "getStatus":
        return this.getAttached(params.groupid).job.status;

      case "pause":
        return await this.getAttached(params.groupid).job.pause({ timeout: Number(params.timeout ?? 5000) });

      case "continue": {
        const entry = this.getAttached(params.groupid);
        await entry.breakpoints.stepDone();
        entry.job.continue();
        return null;
      }

      case "step": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        await entry.breakpoints.stepDone();
        await entry.breakpoints.step(String(params.kind) as StepKind);
        return null;
      }

      case "stepDone":
        await this.getAttached(params.groupid).breakpoints.stepDone();
        return null;

      case "terminate":
        this.getAttached(params.groupid).job.terminate();
        return null;

      case "getStack": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        return await getJobStack(entry.job, entry.job.status, {
          variableFrames: (params.variableFrames as number[] | undefined) ?? [],
          maxDepth: Number(params.maxDepth ?? 2)
        });
      }

      case "getFrameVariables": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        const frame = entry.job.status.stacktrace?.[Number(params.frame)];
        if (!frame)
          throw new Error(`No frame #${String(params.frame)}`);
        return await getFrameVariables(entry.job, frame, { maxDepth: Number(params.maxDepth ?? 0) });
      }

      case "getVariables": {
        // Raw values, rendered one level deep. Used to expand a value by its id
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        const values = await entry.job.getVariables(params.requests as GetVariablesRequest[]);
        return values.map((value, idx) => renderVariable(String((params.requests as GetVariablesRequest[])[idx].id), value, 1));
      }

      case "getHandles": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        return await entry.job.getHandleList();
      }

      case "setBreakpoints": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        if (params.liburi !== undefined)
          return await entry.breakpoints.setLibraryBreakpoints(String(params.liburi), (params.lines as number[]) ?? []);
        return await entry.breakpoints.setLineBreakpoints((params.breakpoints as LineBreakpointRequest[]) ?? [], { breakOnException: Boolean(params.breakOnException) });
      }

      case "setBreakOnException": {
        const entry = this.getAttached(params.groupid);
        this.requirePaused(entry);
        await entry.breakpoints.setBreakOnException(Boolean(params.enable));
        return null;
      }

      case "profileJob":
        return await profileJob(this.conn, String(params.groupid), { duration: Number(params.duration ?? 5000) });

      case "listStoredProfileSessions":
        return await listStoredProfileSessions();

      case "listStoredProfiles":
        return await listStoredProfiles(String(params.session ?? "default"), { filter: String(params.filter ?? ""), limit: Number(params.limit ?? 20) });

      case "readStoredProfile":
        return await readStoredProfile(String(params.session), String(params.filename));

      case "readSource": {
        // Source of a library, so a remote debugger doesn't need access to the files
        const liburi = String(params.liburi);
        const fspath = toFSPath(liburi, { allowUnmatched: true });
        if (!fspath)
          throw new Error(`Cannot resolve '${liburi}' to a file`);
        return { path: fspath, source: await readFile(fspath, "utf-8") };
      }

      case "resolvePath": {
        // Map a local file path to a library uri (for breakpoints set on a file)
        return { liburi: resolvePathToLibUri(String(params.path)) };
      }
    }
    throw new Error(`Unknown method '${method}'`);
  }

  close() {
    for (const entry of this.attached.values()) {
      entry.removeListener();
      entry.job.detach();
    }
    this.attached.clear();
  }
}

/** Map a file in a module or the WebHare installation to its library uri (mod::module/path, or wh::path for whlibs) */
export function resolvePathToLibUri(fspath: string): string | null {
  for (const [name, mod] of Object.entries(backendConfig.module))
    if (fspath.startsWith(mod.root))
      return `mod::${name}/${fspath.substring(mod.root.length)}`;
  const whlibs = backendConfig.installationRoot + "modules/system/whlibs/";
  if (fspath.startsWith(whlibs))
    return `wh::${fspath.substring(whlibs.length)}`;
  return null;
}

/** Run the agent on a pair of streams until the input ends */
export async function runHSDebugAgent(input: Readable, output: Writable): Promise<void> {
  const write = (msg: unknown) => output.write(encodeWire(msg) + "\n");
  const conn = await HSDebugConnection.connect();
  const agent = new HSDebugAgent(conn, (method, params) => write({ jsonrpc: "2.0", method, params }));
  const pending = new Set<Promise<void>>();

  try {
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim())
        continue;

      let request: { id?: number | string; method?: string; params?: Params };
      try {
        request = decodeWire(line) as typeof request;
      } catch (e) {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${(e as Error).message}` } });
        continue;
      }

      const handle = (async () => {
        try {
          const result = await agent.call(String(request.method), request.params ?? {});
          if (request.id !== undefined)
            write({ jsonrpc: "2.0", id: request.id, result: result ?? null });
        } catch (e) {
          if (request.id !== undefined)
            write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: (e as Error).message } });
        }
      })();
      pending.add(handle);
      void handle.finally(() => pending.delete(handle));
    }
    await Promise.all(pending);
  } finally {
    agent.close();
    conn.close();
  }
}
