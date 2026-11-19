/* Shared between `wh devkit:container` and the file watcher it starts (scripts/libexec/container-watcher.ts) */

import { CLIRuntimeError } from "@webhare/cli";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export const containerBinary = "podman";
export const labelPrefix = "dev.webhare.devkit-container";
export const containerPrefix = "wh-devkit-";
export const sourceRootInContainer = "/opt/wh";
export const modulesRootInContainer = "/opt/whmodules"; //the devcontainer image sets WEBHARE_MODULEPATHS to this

export interface DevkitContainer {
  name: string;
  containerName: string;
  state: string;
  checkout: string;
  hostPort: number;
  modules: MountedModule[];
}

export interface MountedModule {
  name: string;
  /** Module root on the host */
  root: string;
}

export function runPodman(args: string[], { allowFail = false } = {}) {
  const result = spawnSync(containerBinary, args, { encoding: "utf-8" });
  if (result.error)
    throw new CLIRuntimeError(`Could not run ${containerBinary}: ${result.error.message}`);
  if (result.status !== 0 && !allowFail)
    throw new CLIRuntimeError(`${containerBinary} ${args[0]} failed: ${result.stderr.trim()}`);
  return result;
}

export function runGit(checkout: string, args: string[]): string {
  const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf-8" });
  if (result.status !== 0)
    throw new CLIRuntimeError(`git ${args[0]} failed in ${checkout}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function listContainers(): DevkitContainer[] {
  const result = runPodman(["ps", "-a", "--filter", `label=${labelPrefix}.name`, "--format", "json"]);
  const rows = JSON.parse(result.stdout || "[]") as Array<{ Names: string[]; State: string; Labels: Record<string, string> }>;
  return rows.map(row => ({
    name: row.Labels[`${labelPrefix}.name`],
    containerName: row.Names[0],
    state: row.State,
    checkout: row.Labels[`${labelPrefix}.checkout`],
    hostPort: parseInt(row.Labels[`${labelPrefix}.hostport`]),
    modules: JSON.parse(row.Labels[`${labelPrefix}.modules`] || "[]") as MountedModule[],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function getContainer(name: string): DevkitContainer {
  const match = listContainers().find(container => container.name === name);
  if (!match)
    throw new CLIRuntimeError(`No devkit container named '${name}', see 'wh devkit:container list'`);
  return match;
}

/** Podman container names are global to the user (and not tied to a WebHare installation), so we keep the watcher's
    socket and log in the user's temporary directory rather than in a WebHare data root */
function getWatcherDir() {
  const dir = path.join(os.tmpdir(), "wh-devkit");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Unix socket paths are limited to 104 (macOS) or 108 (Linux) bytes including the terminating NUL */
const maxSocketPathLength = 100;

export function getWatcherFiles(name: string) {
  const dir = getWatcherDir();
  let socket = path.join(dir, `${name}.sock`);
  if (Buffer.byteLength(socket) > maxSocketPathLength)
    socket = path.join(dir, createHash("sha256").update(name).digest("hex").substring(0, 16) + ".sock");
  return { socket, logFile: path.join(dir, `${name}.watcher.log`) };
}

/** Send a command to a container's watcher. Resolves with its reply, or null if no watcher is listening */
export function sendWatcherCommand(name: string, command: "ping" | "stop", { timeout = 5000 } = {}): Promise<string | null> {
  return new Promise(resolve => {
    let reply = "", connected = false;
    const socket = connect(getWatcherFiles(name).socket);
    socket.setEncoding("utf-8");
    socket.setTimeout(timeout, () => socket.destroy());
    socket.once("connect", () => {
      connected = true;
      socket.write(command + "\n"); //the watcher closes the connection after replying
    });
    socket.on("data", (data: string) => reply += data);
    socket.once("error", () => { }); //'close' follows. ENOENT/ECONNREFUSED mean no watcher is running
    socket.once("close", () => resolve(connected ? reply.trim() : null));
  });
}

/** Whether a watcher is listening on the container's socket. A watcher that accepts the connection but doesn't answer in
    time (eg. because it's busy) still counts as running, so we never start a second watcher that takes over its socket */
export async function isWatcherRunning(name: string): Promise<boolean> {
  return await sendWatcherCommand(name, "ping") !== null;
}
