/* Debug Adapter Protocol (DAP) adapter for HareScript, so editors like VS Code can debug HareScript jobs.
   Started by `wh debug harescript-dap`, which speaks DAP on stdin/stdout.

   The adapter talks to a HareScript debug agent (agent.ts): in-process for the local WebHare, or a command that runs
   `wh debug harescript-agent` elsewhere (eg in a container) for a remote one. Launch configuration ('attach' request):
   - script: attach to the newest job whose script contains this text, or
   - groupid: attach to this job
   - agentCommand: command to start a remote agent, eg ["podman", "exec", "-i", "wh-devkit-x", "wh", "debug", "harescript-agent"]
     (alternatively, run the adapter itself on the remote side, see 'adapterCommand' in the VS Code extension)
   - localRoot, remoteRoot: map local paths (in the editor) to paths on the remote side, eg a worktree to /opt/wh
   - stopOnAttach: pause the job right after attaching

   A job only has one thread. Sources are reported as local files when they can be mapped, otherwise their contents are
   sent through the adapter (sourceReference).
*/

import { existsSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { HSDebugAgentClient } from "./agentclient";
import type { ResolvedLineBreakpoint } from "./breakpoints";
import { PauseReason, type DebugJobStatus } from "./protocol";
import type { RenderedVariable } from "./variables";

/** DAP thread id of the job */
const threadId = 1;
/** Maximum number of items shown when expanding a record, object or array */
const maxExpandedItems = 1000n;

interface DAPMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  arguments?: Record<string, unknown>;
}

interface AttachArguments {
  script?: string;
  groupid?: string;
  agentCommand?: string[];
  localRoot?: string;
  remoteRoot?: string;
  stopOnAttach?: boolean;
}

type VariableReference = { kind: "frame"; frame: number } | { kind: "value"; id: number };

class DAPError extends Error { }

/** Reads DAP messages (Content-Length framed JSON) from a stream */
function readMessages(input: Readable, onMessage: (msg: DAPMessage) => void) {
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (; ;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0)
        return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number(header.match(/Content-Length: *(\d+)/i)?.[1]);
      if (!Number.isFinite(length)) { // garbage, skip the header
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      if (buffer.length < headerEnd + 4 + length)
        return;
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf-8");
      buffer = buffer.subarray(headerEnd + 4 + length);
      onMessage(JSON.parse(body) as DAPMessage);
    }
  });
}

export class HareScriptDebugAdapter {
  private readonly output: Writable;
  private seq = 0;
  private agent: HSDebugAgentClient | null = null;
  private groupid = "";
  private status: DebugJobStatus | null = null;
  private args: AttachArguments = {};
  private configured = false;
  /** Breakpoints per library, set before the configuration was done */
  private pendingBreakpoints = new Map<string, number[]>();
  private breakOnException = false;
  /** Set while we pause the job ourselves (eg to set breakpoints), so that pause isn't reported as a stop */
  private internalPause = false;
  /** Why we expect the next stop */
  private expectedStop: "step" | "pause" | "entry" | null = null;
  private references = new Map<number, VariableReference>();
  private nextReference = 1;
  private sources = new Map<number, string>(); // sourceReference -> liburi
  private sourceRefs = new Map<string, number>(); // liburi -> sourceReference
  private remotePaths = new Map<string, string>(); // liburi -> path on the remote side

  constructor(input: Readable, output: Writable) {
    this.output = output;
    readMessages(input, msg => void this.handle(msg));
  }

  private write(msg: Record<string, unknown>) {
    const body = JSON.stringify({ seq: ++this.seq, ...msg });
    this.output.write(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`);
  }

  private sendEvent(event: string, body?: Record<string, unknown>) {
    this.write({ type: "event", event, body });
  }

  private log(text: string) {
    this.sendEvent("output", { category: "console", output: text + "\n" });
  }

  private async handle(msg: DAPMessage) {
    if (msg.type !== "request" || !msg.command)
      return;
    try {
      const body = await this.dispatch(msg.command, msg.arguments ?? {});
      this.write({ type: "response", request_seq: msg.seq, success: true, command: msg.command, body: body ?? {} });
    } catch (e) {
      this.write({ type: "response", request_seq: msg.seq, success: false, command: msg.command, message: (e as Error).message });
    }
    if (msg.command === "disconnect")
      this.output.end();
  }

  private requireAgent(): HSDebugAgentClient {
    if (!this.agent)
      throw new DAPError("Not attached to a job");
    return this.agent;
  }

  private async dispatch(command: string, args: Record<string, unknown>): Promise<Record<string, unknown> | void> {
    switch (command) {
      case "initialize":
        return {
          supportsConfigurationDoneRequest: true,
          supportsTerminateRequest: true,
          supportsLoadedSourcesRequest: false,
          exceptionBreakpointFilters: [{ filter: "all", label: "All exceptions", default: false }]
        };

      case "launch":
        throw new DAPError("Launching isn't supported, use an 'attach' configuration");

      case "attach":
        await this.attach(args as AttachArguments);
        this.sendEvent("initialized");
        return;

      case "setBreakpoints":
        return { breakpoints: await this.setBreakpoints(args) };

      case "setExceptionBreakpoints": {
        this.breakOnException = ((args.filters as string[]) ?? []).includes("all");
        if (this.configured)
          await this.whilePaused(() => this.requireAgent().call("setBreakOnException", { groupid: this.groupid, enable: this.breakOnException }));
        return;
      }

      case "configurationDone":
        await this.configurationDone();
        return;

      case "threads":
        return { threads: [{ id: threadId, name: this.status?.script || this.groupid }] };

      case "pause":
        this.expectedStop = "pause";
        await this.requireAgent().call("pause", { groupid: this.groupid });
        return;

      case "continue":
        this.resetReferences();
        await this.requireAgent().call("continue", { groupid: this.groupid });
        return { allThreadsContinued: true };

      case "next":
      case "stepIn":
      case "stepOut": {
        this.resetReferences();
        this.expectedStop = "step";
        await this.requireAgent().call("step", { groupid: this.groupid, kind: command === "next" ? "over" : command === "stepIn" ? "in" : "out" });
        return;
      }

      case "stackTrace":
        return await this.stackTrace(args);

      case "scopes": {
        const frame = Number(args.frameId) - 1;
        return { scopes: [{ name: "Locals", presentationHint: "locals", variablesReference: this.addReference({ kind: "frame", frame }), expensive: false }] };
      }

      case "variables":
        return { variables: await this.variables(Number(args.variablesReference)) };

      case "source": {
        const liburi = this.sources.get(Number(args.sourceReference));
        if (!liburi)
          throw new DAPError("Unknown source");
        const result = await this.requireAgent().call<{ source: string }>("readSource", { liburi });
        return { content: result.source, mimeType: "text/x-harescript" };
      }

      case "evaluate":
        throw new DAPError("Evaluating expressions isn't supported for HareScript");

      case "terminate":
        await this.requireAgent().call("terminate", { groupid: this.groupid });
        return;

      case "disconnect":
        await this.disconnect();
        return;
    }
    throw new DAPError(`Unsupported request '${command}'`);
  }

  private async attach(args: AttachArguments) {
    this.args = args;
    this.agent = args.agentCommand?.length ? HSDebugAgentClient.spawn(args.agentCommand) : HSDebugAgentClient.inProcess();
    this.agent.on("jobStatus", ({ groupid, status }) => {
      if (groupid === this.groupid)
        this.gotStatus(status);
    });
    this.agent.on("jobDetached", ({ groupid }) => {
      if (groupid === this.groupid)
        this.sendEvent("terminated");
    });
    this.agent.on("close", ({ error }) => {
      if (error)
        this.log(error);
      this.sendEvent("terminated");
    });

    let groupid = args.groupid;
    if (!groupid) {
      if (!args.script)
        throw new DAPError("Specify the 'script' or 'groupid' of the job to attach to (in VS Code you can also attach from the HareScript Jobs view)");
      const jobs = await this.agent.call<Array<{ groupid: string; script: string; creationdate: Date }>>("listJobs", { filter: args.script });
      jobs.sort((a, b) => b.creationdate.getTime() - a.creationdate.getTime());
      if (!jobs.length)
        throw new DAPError(`No running HareScript job matches '${args.script}'`);
      groupid = jobs[0].groupid;
    }
    this.groupid = groupid;
    this.status = await this.agent.call<DebugJobStatus>("attach", { groupid });
    this.log(`Attached to job ${groupid} (${this.status.script})`);
  }

  private async configurationDone() {
    this.configured = true;
    if (!this.pendingBreakpoints.size && !this.breakOnException && !this.args.stopOnAttach)
      return;

    if (this.args.stopOnAttach)
      this.expectedStop = "entry";
    await this.whilePaused(async () => {
      for (const [liburi, lines] of this.pendingBreakpoints)
        await this.applyBreakpoints(liburi, lines);
      if (this.breakOnException)
        await this.requireAgent().call("setBreakOnException", { groupid: this.groupid, enable: true });
    }, { stayPaused: Boolean(this.args.stopOnAttach) });
    this.pendingBreakpoints.clear();
  }

  /** Run a callback while the job is paused. Pauses (and continues) it if it's running */
  private async whilePaused<T>(callback: () => Promise<T>, { stayPaused = false } = {}): Promise<T> {
    const agent = this.requireAgent();
    if (this.status?.realstatus === "DebugStopped")
      return await callback();

    this.internalPause = !stayPaused;
    try {
      this.status = await agent.call<DebugJobStatus>("pause", { groupid: this.groupid });
      if (stayPaused)
        this.reportStop(this.status);
      return await callback();
    } finally {
      if (!stayPaused) {
        await agent.call("continue", { groupid: this.groupid });
        this.internalPause = false;
      }
    }
  }

  private gotStatus(status: DebugJobStatus) {
    const wasStopped = this.status?.realstatus === "DebugStopped";
    this.status = status;
    if (status.realstatus === "DebugStopped" && !wasStopped && !this.internalPause)
      this.reportStop(status);
    else if (status.realstatus === "Terminated") {
      this.sendEvent("exited", { exitCode: 0 });
      this.sendEvent("terminated");
    }
  }

  private reportStop(status: DebugJobStatus) {
    let reason: string = this.expectedStop ?? "pause";
    if (status.pausereason & PauseReason.exception)
      reason = "exception";
    else if (status.pausereason & (PauseReason.breakpoint | PauseReason.manualBreakpoint) && this.expectedStop !== "step")
      reason = "breakpoint";
    this.expectedStop = null;
    void this.agent?.call("stepDone", { groupid: this.groupid }).catch(() => { }); // restore the breakpoints after a step
    this.resetReferences();
    this.sendEvent("stopped", { reason, threadId, allThreadsStopped: true });
  }

  /** Map a local path to a library uri, through the agent (which knows the module roots) */
  private async pathToLibUri(path: string): Promise<string | null> {
    const { localRoot, remoteRoot } = this.args;
    const remotePath = localRoot && remoteRoot && path.startsWith(localRoot) ? remoteRoot + path.substring(localRoot.length) : path;
    return (await this.requireAgent().call<{ liburi: string | null }>("resolvePath", { path: remotePath })).liburi;
  }

  private async setBreakpoints(args: Record<string, unknown>) {
    const source = args.source as { path?: string };
    const lines = ((args.breakpoints as Array<{ line: number }>) ?? []).map(bp => bp.line);
    const liburi = source.path ? await this.pathToLibUri(source.path) : null;
    if (!liburi)
      return lines.map(line => ({ verified: false, line, message: "Not a HareScript library of this WebHare" }));

    if (!this.configured) {
      this.pendingBreakpoints.set(liburi, lines);
      return lines.map(line => ({ verified: true, line }));
    }
    const resolved = await this.whilePaused(() => this.applyBreakpoints(liburi, lines));
    return resolved.map(bp => ({ verified: bp.verified, line: bp.actualLine, message: bp.message }));
  }

  private async applyBreakpoints(liburi: string, lines: number[]): Promise<ResolvedLineBreakpoint[]> {
    return await this.requireAgent().call<ResolvedLineBreakpoint[]>("setBreakpoints", { groupid: this.groupid, liburi, lines });
  }

  private async getSource(liburi: string): Promise<Record<string, unknown>> {
    let remotePath = this.remotePaths.get(liburi);
    if (remotePath === undefined) {
      try {
        remotePath = (await this.requireAgent().call<{ path: string }>("readSource", { liburi })).path;
      } catch {
        remotePath = "";
      }
      this.remotePaths.set(liburi, remotePath);
    }

    const { localRoot, remoteRoot } = this.args;
    const name = liburi.split("/").pop() || liburi;
    // A file under remoteRoot is the editor's file under localRoot. (The adapter may run on the remote side itself, where
    // it can't check whether the local file exists)
    if (remotePath && localRoot && remoteRoot && remotePath.startsWith(remoteRoot))
      return { name, path: localRoot + remotePath.substring(remoteRoot.length) };
    if (remotePath && !(localRoot && remoteRoot) && existsSync(remotePath))
      return { name, path: remotePath };

    let ref = this.sourceRefs.get(liburi);
    if (!ref) {
      ref = this.sourceRefs.size + 1;
      this.sourceRefs.set(liburi, ref);
      this.sources.set(ref, liburi);
    }
    return { name, sourceReference: ref, origin: liburi };
  }

  private async stackTrace(args: Record<string, unknown>) {
    const frames = this.status?.stacktrace ?? [];
    const start = Number(args.startFrame ?? 0), levels = Number(args.levels ?? 0) || frames.length;
    const stackFrames = [];
    for (const [idx, frame] of frames.entries()) {
      if (idx < start || idx >= start + levels)
        continue;
      stackFrames.push({
        id: idx + 1,
        name: frame.func,
        source: frame.filename ? await this.getSource(frame.filename) : undefined,
        line: frame.line,
        column: frame.col,
        presentationHint: frame.codeptr === -1 ? "subtle" : "normal"
      });
    }
    return { stackFrames, totalFrames: frames.length };
  }

  private resetReferences() {
    this.references.clear();
    this.nextReference = 1;
  }

  private addReference(ref: VariableReference): number {
    const id = this.nextReference++;
    this.references.set(id, ref);
    return id;
  }

  private toDAPVariable(variable: RenderedVariable) {
    const expandable = variable.truncated || variable.members.length > 0;
    return {
      name: variable.name,
      value: variable.value,
      variablesReference: expandable ? this.addReference({ kind: "value", id: variable.id }) : 0
    };
  }

  private async variables(reference: number) {
    const ref = this.references.get(reference);
    if (!ref)
      return [];
    if (ref.kind === "frame") {
      const vars = await this.requireAgent().call<RenderedVariable[]>("getFrameVariables", { groupid: this.groupid, frame: ref.frame, maxDepth: 0 });
      return vars.map(v => this.toDAPVariable(v));
    }
    const [value] = await this.requireAgent().call<RenderedVariable[]>("getVariables", { groupid: this.groupid, requests: [{ id: ref.id, max: maxExpandedItems }] });
    return (value?.members ?? []).map(member => this.toDAPVariable(member));
  }

  private async disconnect() {
    if (!this.agent)
      return;
    try {
      await this.agent.call("continue", { groupid: this.groupid }).catch(() => { });
      await this.agent.call("detach", { groupid: this.groupid });
    } finally {
      this.agent.close();
      this.agent = null;
    }
  }
}

/** Run the adapter on a pair of streams */
export function runHareScriptDebugAdapter(input: Readable, output: Writable): Promise<void> {
  new HareScriptDebugAdapter(input, output);
  return new Promise(resolve => output.on("finish", () => resolve()));
}
