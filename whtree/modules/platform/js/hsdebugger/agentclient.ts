/* Client for the HareScript debug agent (agent.ts). The agent can run as a separate process connected through its
   stdin/stdout (eg inside a container or on another machine), or in this process.

     const agent = HSDebugAgentClient.spawn(["podman", "exec", "-i", "wh-devkit-x", "wh", "debug", "harescript-agent"]);
     const jobs = await agent.call("listJobs", {});
*/

import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { createInterface } from "node:readline";
import EventSource from "@mod-system/js/internal/eventsource";
import { decodeWire, encodeWire } from "./wire";
import { runHSDebugAgent } from "./agent";
import type { DebugJobStatus } from "./protocol";

type AgentEvents = {
  jobStatus: { groupid: string; status: DebugJobStatus };
  jobDetached: { groupid: string };
  close: { error?: string };
};

interface JSONRPCMessage {
  id?: number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class HSDebugAgentClient extends EventSource<AgentEvents> {
  private output: Writable;
  private idCounter = 0;
  private pending = new Map<number, PromiseWithResolvers<unknown>>();
  private closed = false;
  private process?: ChildProcess;
  private stderr = "";

  private constructor(input: Readable, output: Writable, child?: ChildProcess) {
    super();
    this.output = output;
    this.process = child;
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", line => this.gotLine(line));
    lines.on("close", () => this.gotClose());
  }

  /** Start an agent with a command, eg ["wh", "debug", "harescript-agent"] or one that runs it in a container or over ssh */
  static spawn(command: string[]): HSDebugAgentClient {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    const client = new HSDebugAgentClient(child.stdout, child.stdin, child);
    child.stderr.on("data", (data: Buffer) => { client.stderr = (client.stderr + data.toString()).slice(-4000); });
    child.on("error", e => { client.stderr += e.message; client.gotClose(); });
    return client;
  }

  /** Run an agent in this process, for debugging the WebHare this process belongs to */
  static inProcess(): HSDebugAgentClient {
    const toAgent = new PassThrough(), fromAgent = new PassThrough();
    const client = new HSDebugAgentClient(fromAgent, toAgent);
    runHSDebugAgent(toAgent, fromAgent).catch(e => {
      client.stderr = (e as Error).message;
    }).finally(() => fromAgent.end());
    return client;
  }

  private gotLine(line: string) {
    if (!line.trim())
      return;
    let msg: JSONRPCMessage;
    try {
      msg = decodeWire(line) as JSONRPCMessage;
    } catch {
      return; // not ours (eg a stray console.log of the remote side)
    }

    if (msg.method) {
      if (msg.method === "jobStatus" || msg.method === "jobDetached")
        this.emit(msg.method, msg.params as never);
      return;
    }
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error)
          pending.reject(new Error(msg.error.message));
        else
          pending.resolve(msg.result);
      }
    }
  }

  private gotClose() {
    if (this.closed)
      return;
    this.closed = true;
    const error = `The debug agent has exited${this.stderr ? `: ${this.stderr.trim()}` : ""}`;
    for (const pending of this.pending.values())
      pending.reject(new Error(error));
    this.pending.clear();
    this.emit("close", { error: this.stderr ? error : undefined });
  }

  /** Call a method of the agent (see HSDebugAgent.call for the methods) */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed)
      throw new Error(`The debug agent has exited${this.stderr ? `: ${this.stderr.trim()}` : ""}`);
    const id = ++this.idCounter;
    const defer = Promise.withResolvers<unknown>();
    this.pending.set(id, defer);
    this.output.write(encodeWire({ jsonrpc: "2.0", id, method, params }) + "\n");
    return await defer.promise as T;
  }

  /** Stop the agent */
  close() {
    this.output.end();
    this.process?.kill();
    this.gotClose();
  }

  [Symbol.dispose]() {
    this.close();
  }
}
