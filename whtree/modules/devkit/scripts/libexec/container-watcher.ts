/* Forward file changes made on the host to a devkit container's file watcher. Started in the background by
   `wh devkit:container create/start`, see doc/devkit-containers.md. To debug it, stop the background watcher and run
   `wh run mod::devkit/scripts/libexec/container-watcher.ts <name>` in the foreground.

   Changes made on the host side of a podman bind mount on macOS don't generate inotify events inside the container, so
   WebHare's watchsourcefiles service never sees them. We watch the checkout and mounted modules on the host and report
   changed and deleted files using `wh event invalidate-file` inside the container.

   The watcher listens on a unix socket (see getWatcherFiles) so `wh devkit:container` can find and stop it without
   tracking process ids, and exits by itself when the container stops.
*/

import { runCli, CLIRuntimeError } from "@webhare/cli";
import { containerBinary, getContainer, getWatcherFiles, isWatcherRunning, modulesRootInContainer, runGit, sourceRootInContainer, type DevkitContainer } from "@mod-devkit/js/containers/support";
import { spawn, spawnSync } from "node:child_process";
import { rmSync, statSync, watch } from "node:fs";
import { createServer, type Server } from "node:net";
import * as path from "node:path";

/** Paths (relative to the checkout) that live in container volumes or are never relevant to the container's file watcher */
const ignoreChangesUnder = ["whtree/node_modules/", "whtree/currentinstall/"];

function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}

/** Listen on the watcher socket, failing if another watcher for this container is already listening */
async function listen(name: string, onCommand: (command: string) => string): Promise<Server> {
  if (await isWatcherRunning(name))
    throw new CLIRuntimeError(`A watcher for '${name}' is already running`);

  const { socket } = getWatcherFiles(name);
  rmSync(socket, { force: true }); //left behind by a watcher that crashed
  const server = createServer(conn => {
    let buffer = "";
    conn.setEncoding("utf-8");
    conn.on("error", () => { });
    conn.on("data", (data: string) => {
      buffer += data;
      const eol = buffer.indexOf("\n");
      if (eol >= 0)
        conn.end(onCommand(buffer.substring(0, eol).trim()) + "\n");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => resolve());
  });
  return server;
}

function watchMount(container: DevkitContainer, { hostRoot, containerRoot, ignoreUnder, submodules }: {
  hostRoot: string;
  containerRoot: string;
  /** Path prefixes (relative to hostRoot) to ignore */
  ignoreUnder: string[];
  /** Submodule paths (relative to hostRoot, with a trailing slash) */
  submodules: string[];
}) {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let flushing = Promise.resolve();

  const toContainerPath = (relPath: string) => path.posix.join(containerRoot, relPath);
  // Like watchsourcefiles, skip hidden files and directories (including .git) and editor backups
  const isRelevant = (relPath: string) => !relPath.split("/").some(part => part.startsWith(".")) && !relPath.endsWith("~") && !ignoreUnder.some(prefix => relPath.startsWith(prefix));

  function filterIgnored(relPaths: string[]): string[] {
    // git check-ignore refuses paths inside submodules, so only pass it paths from the main repository
    const inSubmodule = relPaths.filter(relPath => submodules.some(sub => relPath.startsWith(sub)));
    const inMain = relPaths.filter(relPath => !inSubmodule.includes(relPath));
    if (!inMain.length)
      return inSubmodule;
    const result = spawnSync("git", ["-C", hostRoot, "check-ignore", "--stdin", "-z"], { input: inMain.join("\0"), encoding: "utf-8" });
    if (result.status !== 0 && result.status !== 1) //eg. a module that isn't in a git repository
      return relPaths;
    const ignored = new Set(result.stdout.split("\0"));
    return [...inMain.filter(relPath => !ignored.has(relPath)), ...inSubmodule];
  }

  async function flush() {
    const relPaths = filterIgnored([...pending]);
    pending = new Set;
    if (!relPaths.length)
      return;

    // Skip directories, changes to files in them are reported separately
    const files = relPaths.filter(relPath => {
      try {
        return !statSync(path.join(hostRoot, relPath)).isDirectory();
      } catch {
        return true; //deleted
      }
    });
    if (!files.length)
      return;

    // A WebHare that isn't running doesn't need to be told. Also, `wh event` can't connect to WebHare during a build
    if (spawnSync(containerBinary, ["exec", container.containerName, "wh", "isrunning"]).status !== 0)
      return;

    log(`Changed in ${hostRoot}: ${files.join(", ")}`);
    const result = spawnSync(containerBinary, ["exec", container.containerName, "wh", "event", "invalidate-file", ...files.map(toContainerPath)], { encoding: "utf-8" });
    if (result.status !== 0)
      log(`Failed to forward changes: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  watch(hostRoot, { recursive: true }, (_event, filename) => {
    if (!filename || !isRelevant(filename))
      return;
    pending.add(filename);
    if (timer)
      clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flushing = flushing.then(flush).catch(e => log(`Error forwarding changes: ${e}`));
    }, 100);
  });

  log(`Forwarding changes in ${hostRoot} to ${containerRoot} in container '${container.containerName}'`);
}

runCli({
  description: "Forward file changes made on the host to a devkit container's file watcher, until the container stops",
  arguments: [{ name: "<name>", description: "Container name" }],
  async main({ args }) {
    const container = getContainer(args.name);
    if (container.state !== "running")
      throw new CLIRuntimeError(`Container '${container.name}' is not running`);

    let stopping = false;
    const shutdown = (reason: string) => {
      if (stopping)
        return;
      stopping = true;
      log(`Stopping: ${reason}`);
      waiter.kill();
      server.close();
      rmSync(getWatcherFiles(container.name).socket, { force: true });
      process.exit(0);
    };

    const server = await listen(container.name, command => {
      if (command === "stop") {
        setImmediate(() => shutdown("stop requested"));
        return "ok";
      }
      return command === "ping" ? "pong" : "unknown command";
    });

    // Exit when the container stops or is removed. `podman wait` also returns if it can't reach the container at all
    const waiter = spawn(containerBinary, ["wait", container.containerName], { stdio: "ignore" });
    waiter.on("exit", () => shutdown(`container '${container.containerName}' stopped`));
    waiter.on("error", e => shutdown(`cannot wait for container '${container.containerName}': ${e.message}`));
    process.on("SIGINT", () => shutdown("interrupted"));
    process.on("SIGTERM", () => shutdown("terminated"));

    watchMount(container, {
      hostRoot: container.checkout,
      containerRoot: sourceRootInContainer,
      ignoreUnder: ignoreChangesUnder,
      submodules: runGit(container.checkout, ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"]).split("\n").filter(Boolean).map(line => line.split(" ")[1] + "/"),
    });
    for (const module of container.modules)
      watchMount(container, { hostRoot: module.root, containerRoot: path.posix.join(modulesRootInContainer, module.name), ignoreUnder: [], submodules: [] });

    await new Promise(() => { }); //run until shutdown() exits
  }
});
