/* The 'HareScript Jobs' view in the Run and Debug sidebar: the running HareScript jobs, grouped by process and thread,
   with an action to attach the debugger to a job.

   The jobs are listed by `wh debug harescript-agent`, started for each WebHare we know of: the local one (through
   runkit) and those of the 'harescript' launch configurations (eg one in a devkit container, through its 'agentCommand'
   or 'adapterCommand'). */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import * as vscode from "vscode";

const viewId = "webhare.harescriptJobs";
const refreshIntervalMsecs = 3000;

/** A WebHare to list jobs for */
interface JobTarget {
  /** Identifies the target (the agent command) */
  key: string;
  label: string;
  agentCommand: string[];
  /** Workspace folder of the launch configuration */
  folder?: vscode.WorkspaceFolder;
  /** Debug configuration to start when attaching, without 'script' or 'groupid' */
  config: vscode.DebugConfiguration;
}

/** A job as listed by the agent's 'listJobs' (decoded from its wire format: bigints as strings, dates as msecs) */
interface AgentJob {
  groupid: string;
  script: string;
  status: string;
  creationdate: number;
  runningMsecs: number;
  connected: boolean;
  processcode: string;
  clientname: string;
  /** Not reported by older WebHare versions */
  pid?: number;
  threadid?: number;
}

/** Decodes the agent's JSON wire format (see platform/js/hsdebugger/wire.ts) into plain JSON values */
function decodeWire(text: string): unknown {
  return JSON.parse(text, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const keys = Object.keys(val);
      const rec = val as Record<string, unknown>;
      if (keys.length === 1 && keys[0] === "$bigint")
        return String(rec.$bigint);
      if (keys.length === 1 && keys[0] === "$date")
        return rec.$date ?? 0;
      if (keys.length === 1 && keys[0] === "$money")
        return String(rec.$money);
    }
    return val;
  });
}

/** A running `wh debug harescript-agent`, talking JSON-RPC over its stdin/stdout */
class AgentConnection {
  private readonly proc: ChildProcess;
  private nextId = 0;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private stderr = "";
  closed = false;

  constructor(command: string[]) {
    this.proc = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr!.on("data", (data: Buffer) => { this.stderr = (this.stderr + data.toString()).slice(-2000); });
    this.proc.on("error", e => this.gotClose(e.message));
    this.proc.on("exit", () => this.gotClose());
    createInterface({ input: this.proc.stdout!, crlfDelay: Infinity }).on("line", line => this.gotLine(line));
  }

  private gotLine(line: string) {
    let msg: { id?: number; result?: unknown; error?: { message: string } };
    try {
      msg = decodeWire(line) as typeof msg;
    } catch {
      return; // not a JSON-RPC message
    }
    const pending = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!pending)
      return; // a notification, or an answer to a call we gave up on
    this.pending.delete(msg.id!);
    if (msg.error)
      pending.reject(new Error(msg.error.message));
    else
      pending.resolve(msg.result);
  }

  private gotClose(error?: string) {
    if (this.closed)
      return;
    this.closed = true;
    const message = `The debug agent has exited: ${(error ?? this.stderr.trim()) || "no details"}`;
    for (const pending of this.pending.values())
      pending.reject(new Error(message));
    this.pending.clear();
  }

  call<T>(method: string, params: Record<string, unknown> = {}, timeoutMsecs = 15000): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("The debug agent has exited"));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The debug agent didn't answer '${method}' in time`));
      }, timeoutMsecs);
      this.pending.set(id, {
        resolve: result => { clearTimeout(timer); resolve(result as T); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  close() {
    this.closed = true;
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

type JobsTreeNode =
  | { kind: "target"; target: JobTarget }
  | { kind: "message"; target: JobTarget; text: string; isError: boolean }
  | { kind: "process"; target: JobTarget; pid: number; name: string; jobs: AgentJob[] }
  | { kind: "thread"; target: JobTarget; pid: number; threadid: number; jobs: AgentJob[] }
  | { kind: "job"; target: JobTarget; job: AgentJob };

interface TargetState {
  jobs: AgentJob[];
  error?: string;
  loaded: boolean;
}

function formatRunningTime(msecs: number) {
  const secs = Math.floor(msecs / 1000);
  if (secs < 60)
    return `${secs}s`;
  if (secs < 3600)
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor(secs / 60) % 60}m`;
}

/** The pid of a job's process. Older WebHare versions don't report it, but the processcode of native processes is their pid */
function getPid(job: AgentJob) {
  return job.pid ?? Number(job.processcode);
}

/** The name of a process, from the clientname of (one of) its threads, eg 'runscript mod::x/y.whscr' */
function getProcessName(jobs: AgentJob[]) {
  return (jobs.find(job => !job.threadid) ?? jobs[0]).clientname.replace(/ \(wasm thread \d+\)$/, "");
}

function groupBy<K, T>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

export class HareScriptJobsProvider implements vscode.TreeDataProvider<JobsTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<JobsTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly getRunkitPath: () => string | null;
  private targets: JobTarget[] = [];
  private readonly agents = new Map<string, AgentConnection>();
  private readonly states = new Map<string, TargetState>();
  private timer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private view: vscode.TreeView<JobsTreeNode> | undefined;

  constructor(getRunkitPath: () => string | null) {
    this.getRunkitPath = getRunkitPath;
  }

  /** Registers the view and its commands */
  register(context: vscode.ExtensionContext) {
    this.view = vscode.window.createTreeView(viewId, { treeDataProvider: this, showCollapseAll: true });
    context.subscriptions.push(this.view, this,
      this.view.onDidChangeVisibility(() => this.updatePolling()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("launch") || e.affectsConfiguration("webhare"))
          this.resetTargets();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.resetTargets()),
      vscode.debug.onDidStartDebugSession(() => void this.refresh()),
      vscode.debug.onDidTerminateDebugSession(() => void this.refresh()),
      vscode.commands.registerCommand("webhare.harescriptJobs.refresh", () => this.refresh()),
      vscode.commands.registerCommand("webhare.harescriptJobs.attach", (node?: JobsTreeNode) => this.attach(node))
    );
    this.resetTargets();
  }

  /** Collects the WebHares to list jobs for: the local one and those of the 'harescript' launch configurations */
  private findTargets(): JobTarget[] {
    const targets = new Map<string, JobTarget>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const configs = vscode.workspace.getConfiguration("launch", folder).get<vscode.DebugConfiguration[]>("configurations") ?? [];
      for (const config of configs) {
        if (config.type !== "harescript")
          continue;
        const agentCommand = this.getAgentCommand(config);
        const key = JSON.stringify(agentCommand);
        if (!targets.has(key)) {
          const { script: _script, groupid: _groupid, stopOnAttach: _stopOnAttach, ...base } = config;
          targets.set(key, { key, label: config.name, agentCommand, folder, config: base });
        }
      }
    }

    // The local WebHare, unless a launch configuration already covers it
    const localCommand = this.getAgentCommand(null);
    const localKey = JSON.stringify(localCommand);
    if (!targets.has(localKey) && (this.getRunkitPath() || !targets.size))
      targets.set(localKey, {
        key: localKey,
        label: "Local WebHare",
        agentCommand: localCommand,
        folder: vscode.workspace.workspaceFolders?.[0],
        config: { type: "harescript", request: "attach", name: "Attach to a HareScript job" }
      });
    return [...targets.values()];
  }

  /** The command that starts an agent for a launch configuration (or for the local WebHare) */
  private getAgentCommand(config: vscode.DebugConfiguration | null): string[] {
    const agentCommand = config?.agentCommand as string[] | undefined;
    if (agentCommand?.length)
      return agentCommand;
    // An adapter run elsewhere ('podman exec -i <container> wh debug harescript-dap') has an agent there too
    const adapterCommand = config?.adapterCommand as string[] | undefined;
    if (adapterCommand?.length && adapterCommand.at(-1) === "harescript-dap")
      return [...adapterCommand.slice(0, -1), "harescript-agent"];
    const runkit = this.getRunkitPath();
    return runkit ? [runkit, "wh", "debug", "harescript-agent"] : ["wh", "debug", "harescript-agent"];
  }

  private resetTargets() {
    this.targets = this.findTargets();
    const keys = new Set(this.targets.map(target => target.key));
    for (const [key, agent] of this.agents)
      if (!keys.has(key)) {
        agent.close();
        this.agents.delete(key);
        this.states.delete(key);
      }
    this.changeEmitter.fire(undefined);
    void this.refresh();
  }

  /** Polls the jobs while the view is visible, and stops the agents when it isn't */
  private updatePolling() {
    if (this.view?.visible) {
      if (!this.timer) {
        this.timer = setInterval(() => void this.refresh(), refreshIntervalMsecs);
        void this.refresh();
      }
    } else {
      clearInterval(this.timer);
      this.timer = undefined;
      for (const agent of this.agents.values())
        agent.close();
      this.agents.clear();
    }
  }

  async refresh() {
    if (this.refreshing || !this.view?.visible)
      return;
    this.refreshing = true;
    try {
      await Promise.all(this.targets.map(target => this.refreshTarget(target)));
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshTarget(target: JobTarget) {
    const previous = this.states.get(target.key);
    let state: TargetState;
    try {
      let agent = this.agents.get(target.key);
      if (!agent || agent.closed) {
        agent = new AgentConnection(target.agentCommand);
        this.agents.set(target.key, agent);
      }
      const jobs = await agent.call<AgentJob[]>("listJobs");
      jobs.sort((a, b) => a.creationdate - b.creationdate);
      state = { jobs, loaded: true };
    } catch (e) {
      state = { jobs: [], error: (e as Error).message, loaded: true };
    }
    this.states.set(target.key, state);
    if (JSON.stringify(state) !== JSON.stringify(previous)) // don't collapse or flicker the tree if nothing changed
      this.changeEmitter.fire(undefined);
  }

  getChildren(node?: JobsTreeNode): JobsTreeNode[] {
    if (!node)
      return this.targets.length === 1
        ? this.getTargetChildren(this.targets[0])
        : this.targets.map(target => ({ kind: "target", target }));

    switch (node.kind) {
      case "target":
        return this.getTargetChildren(node.target);
      case "process": {
        const threads = groupBy(node.jobs, job => job.threadid ?? 0);
        // Only show threads when the process runs jobs on worker threads
        if (threads.size === 1 && threads.has(0))
          return node.jobs.map(job => ({ kind: "job", target: node.target, job }));
        return [...threads].sort(([a], [b]) => a - b).map(([threadid, jobs]) => ({ kind: "thread", target: node.target, pid: node.pid, threadid, jobs }));
      }
      case "thread":
        return node.jobs.map(job => ({ kind: "job", target: node.target, job }));
      default:
        return [];
    }
  }

  private getTargetChildren(target: JobTarget): JobsTreeNode[] {
    const state = this.states.get(target.key);
    if (!state?.loaded)
      return [{ kind: "message", target, text: "Loading…", isError: false }];
    if (state.error)
      return [{ kind: "message", target, text: state.error, isError: true }];
    if (!state.jobs.length)
      return [{ kind: "message", target, text: "No HareScript jobs are running", isError: false }];
    return [...groupBy(state.jobs, getPid)].map(([pid, jobs]) => ({ kind: "process", target, pid, name: getProcessName(jobs), jobs }));
  }

  getTreeItem(node: JobsTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "target": {
        const item = new vscode.TreeItem(node.target.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `target:${node.target.key}`;
        item.iconPath = new vscode.ThemeIcon("server-environment");
        item.tooltip = node.target.agentCommand.join(" ");
        return item;
      }
      case "message": {
        const item = new vscode.TreeItem(node.text.split("\n")[0], vscode.TreeItemCollapsibleState.None);
        item.tooltip = node.text;
        if (node.isError)
          item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        return item;
      }
      case "process": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `process:${node.target.key}:${node.pid}`;
        item.description = `pid ${node.pid}`;
        item.iconPath = new vscode.ThemeIcon("server-process");
        item.contextValue = "harescriptProcess";
        return item;
      }
      case "thread": {
        const item = new vscode.TreeItem(node.threadid ? `Worker thread ${node.threadid}` : "Main thread", vscode.TreeItemCollapsibleState.Expanded);
        item.id = `thread:${node.target.key}:${node.pid}:${node.threadid}`;
        item.iconPath = new vscode.ThemeIcon("symbol-event");
        return item;
      }
      case "job": {
        const { job } = node;
        const item = new vscode.TreeItem(job.script, vscode.TreeItemCollapsibleState.None);
        item.id = `job:${node.target.key}:${job.groupid}`;
        item.description = job.connected ? `${job.status} · debugger attached` : job.status;
        item.iconPath = new vscode.ThemeIcon(job.status === "DebugStopped" ? "debug-pause" : job.connected ? "debug" : "play-circle");
        item.contextValue = job.connected ? "harescriptJobAttached" : "harescriptJob";
        item.tooltip = new vscode.MarkdownString([
          `**${job.script}**`,
          `Status: ${job.status}${job.connected ? " (a debugger is attached)" : ""}`,
          `Started: ${new Date(job.creationdate).toLocaleString()}`,
          `Running time: ${formatRunningTime(job.runningMsecs)}`,
          `Process: ${job.clientname}`,
          `Group id: \`${job.groupid}\``
        ].join("\n\n"));
        return item;
      }
    }
  }

  /** Starts a debug session attached to a job */
  private async attach(node?: JobsTreeNode) {
    if (node?.kind !== "job")
      return;
    if (node.job.connected) {
      const answer = await vscode.window.showWarningMessage(`A debugger is already attached to ${node.job.script}. Detach it first (eg in the Debugger app).`, "Try anyway");
      if (!answer)
        return;
    }
    const config: vscode.DebugConfiguration = {
      ...node.target.config,
      name: `HareScript: ${node.job.script.replace(/^.*\//, "")}`,
      groupid: node.job.groupid
    };
    await vscode.debug.startDebugging(node.target.folder, config);
  }

  dispose() {
    clearInterval(this.timer);
    for (const agent of this.agents.values())
      agent.close();
    this.agents.clear();
    this.changeEmitter.dispose();
  }
}
