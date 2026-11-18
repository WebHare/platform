// @webhare/cli: Manage devkit containers for testing worktrees

/* Devkit containers run a WebHare source checkout (usually a git worktree) inside the devcontainer image, so changes
   can be built and tested on Linux without touching the host's own WebHare installation. See doc/devkit-containers.md
*/

import { runCli, CLIRuntimeError, type CLIArgumentType } from "@webhare/cli";
import { backendConfig } from "@webhare/services";
import { regExpFromWildcards } from "@webhare/std";
import { containerBinary, containerPrefix, getContainer, getWatcherFiles, isWatcherRunning, labelPrefix, listContainers, modulesRootInContainer, runGit, runPodman, sendWatcherCommand, sourceRootInContainer, type DevkitContainer, type MountedModule } from "@mod-devkit/js/containers/support";
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, realpathSync, rmSync } from "node:fs";
import * as path from "node:path";

const defaultImage = "localhost/webhare/platform:devcontainer";
const firstHostPort = 14700;
const hostPortStep = 10;
/** Podman container states in which nothing runs inside the container */
const stoppedStates = ["created", "configured", "exited", "stopped"];
const watcherScript ="mod::devkit/scripts/libexec/container-watcher.ts";

const containerNameArg = {
  parseValue(arg) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(arg))
      throw new Error(`Invalid container name '${arg}', use up to 40 lowercase letters, digits, '-' and '_'`);
    return arg;
  },
} satisfies CLIArgumentType<string>;

/** Each container has a single volume for its data, with subfolders mounted at the paths below. This uses a different
    prefix than the containers and the shared build root volume, so no container name can clash with them */
const volumePrefix = "wh-devcontainer-";

function getVolumeName(name: string) {
  return volumePrefix + name;
}

/** Subfolders of a container's volume and where they're mounted */
const volumeMounts = [
  { subpath: "whdata", target: "/opt/whdata" }, //database and other data
  { subpath: "build", target: "/opt/whbuild" }, //build directory
  { subpath: "node_modules", target: `${sourceRootInContainer}/whtree/node_modules` }, //Linux binaries, can't be shared with the host
  { subpath: "currentinstall", target: `${sourceRootInContainer}/whtree/currentinstall` },
];

/** Create the container's volume (or reuse one kept by 'remove --keep-volumes') and its subfolders. A subfolder must exist
    before it can be mounted. Podman also doesn't copy the image's contents into a subfolder like it does for an empty volume,
    so we do that ourselves (without overwriting anything already there) */
function prepareVolume(name: string, image: string) {
  const volume = getVolumeName(name);
  if (runPodman(["volume", "exists", volume], { allowFail: true }).status !== 0)
    runPodman(["volume", "create", "--label", `${labelPrefix}.name=${name}`, volume]);

  const script = volumeMounts.map(mount => `mkdir -p /v/${mount.subpath} && if [ -d ${mount.target} ]; then cp -an ${mount.target}/. /v/${mount.subpath}/; fi`).join(" && ");
  runPodman(["run", "--rm", "--security-opt", "label=disable", "--entrypoint", "bash", "-v", `${volume}:/v`, image, "-c", script]);
  return volume;
}

/** Shared between all devkit containers, ccache and downloaded build dependencies */
const buildRootVolume = `${containerPrefix}buildroot`;

/** Start the watcher that forwards file changes on the host to the container, and wait for it to listen. It exits by
    itself when the container stops */
async function startWatcher(name: string) {
  if (await isWatcherRunning(name))
    return;
  const { logFile } = getWatcherFiles(name);
  const logFd = openSync(logFile, "a");
  const proc = spawn(path.join(backendConfig.installationRoot, "bin/wh"), ["run", watcherScript, name], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  proc.unref();

  for (const deadline = Date.now() + 15_000; proc.exitCode === null && proc.signalCode === null && Date.now() < deadline;) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (await isWatcherRunning(name))
      return;
  }
  console.warn(`Warning: the file watcher for '${name}' did not start, changes on the host won't reach the container. See ${logFile}`);
}

async function stopWatcher(name: string) {
  await sendWatcherCommand(name, "stop");
}

/** The podman VM's clock can fall behind after the host sleeps. Files in the checkout then get host timestamps and files in
    volumes VM timestamps, which breaks make and configure scripts. Podman 6 keeps the clock in sync, but only if the
    machine's OS is also version 6 or newer: machines created with Podman 5 keep their OS when podman itself is upgraded,
    and `podman machine os upgrade` can't upgrade them from 5 to 6 (https://github.com/podman-container-tools/podman/issues/29034) */
function checkClockSkew(container: DevkitContainer) {
  const result = runPodman(["exec", container.containerName, "date", "+%s"], { allowFail: true });
  const skew = Math.abs(parseInt(result.stdout) - Math.floor(Date.now() / 1000));
  if (skew <= 5)
    return;

  const machineOS = runPodman(["machine", "ssh", "podman version --format '{{.Client.Version}}'"], { allowFail: true }).stdout.trim();
  const hostVersion = runPodman(["version", "--format", "{{.Client.Version}}"], { allowFail: true }).stdout.trim();
  console.warn(`Warning: the container's clock is ${skew} seconds off, which will break builds. Fix it for now with: podman machine ssh "sudo date -u -s @$(date +%s)"`);
  if (parseInt(machineOS) < 6 && parseInt(hostVersion) >= 6) {
    const [major, minor] = hostVersion.split(".");
    console.warn(`Your podman machine runs a Podman ${machineOS} OS, which doesn't keep its clock in sync with the host. Upgrade it (this restarts the machine and stops all containers) with: podman machine os apply quay.io/podman/machine-os:${major}.${minor} --restart`);
  }
}

async function startContainer(container: DevkitContainer) {
  if (container.state !== "running")
    runPodman(["start", container.containerName]);
  checkClockSkew(container);
  await startWatcher(container.name);
}

/** Verify the checkout is a WebHare source tree we can safely mount, and prepare it for use in a container */
function prepareCheckout(checkoutArg: string, { force }: { force: boolean }) {
  const checkout = realpathSync(checkoutArg);
  if (!existsSync(path.join(checkout, "builder/make.sh")) || !existsSync(path.join(checkout, "whtree")))
    throw new CLIRuntimeError(`${checkout} is not a WebHare platform source checkout`);

  // `wh make install` writes Linux binaries into whtree/bin and whtree/lib, which would break the host's own installation
  const ownInstallation = realpathSync(backendConfig.installationRoot);
  if (ownInstallation.startsWith(checkout + "/") && !force)
    throw new CLIRuntimeError(`${checkout} is the checkout this WebHare runs from. Building it in a container replaces its binaries with Linux binaries. Use a git worktree instead, or --force if you really want this`);

  // Submodules must be checked out on the host. The container has no credentials to clone them, and a clone made inside
  // the container records paths that only make sense inside the container
  runGit(checkout, ["submodule", "update", "--init", "--recursive"]);

  // A worktree's .git file points to the main repository's .git directory. That needs to be mounted at the same path
  // for git to work inside the container, and `wh make install` needs git to generate the build info
  const gitDir = runGit(checkout, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const gitCommonDir = runGit(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return { checkout, gitCommonDir: gitDir !== gitCommonDir ? gitCommonDir : null };
}

/** Resolve a --module argument, either a path to a module or the name of a module installed in this WebHare */
function resolveModule(arg: string): MountedModule {
  let root: string;
  if (arg.includes("/") || existsSync(arg)) {
    if (!existsSync(arg))
      throw new CLIRuntimeError(`Module directory ${arg} does not exist`);
    root = realpathSync(arg);
  } else {
    const installed = backendConfig.module[arg];
    if (!installed)
      throw new CLIRuntimeError(`No module named '${arg}' is installed in this WebHare, pass the path to the module instead`);
    root = realpathSync(installed.root);
  }
  if (!existsSync(path.join(root, "moduledefinition.yml")) && !existsSync(path.join(root, "moduledefinition.xml")))
    throw new CLIRuntimeError(`${root} is not a WebHare module, it has no moduledefinition.yml or moduledefinition.xml`);
  return { name: path.basename(root), root };
}

function allocateHostPort(): number {
  const inUse = new Set(listContainers().map(container => container.hostPort));
  let port = firstHostPort;
  while (inUse.has(port))
    port += hostPortStep;
  return port;
}

/** Run a command inside the container, attached to our terminal. Returns its exit code */
async function execInContainer(container: DevkitContainer, command: string[], { tty = Boolean(process.stdin.isTTY && process.stdout.isTTY) } = {}): Promise<number> {
  if (container.state !== "running")
    throw new CLIRuntimeError(`Container '${container.name}' is not running, start it with 'wh devkit:container start ${container.name}'`);
  const proc = spawn(containerBinary, ["exec", "-i", ...(tty ? ["-t"] : []), "-w", sourceRootInContainer, container.containerName, ...command], { stdio: "inherit" });
  return await new Promise<number>(resolve => proc.on("exit", code => resolve(code ?? 1)));
}

runCli({
  description: "Manage devkit containers: long-running devcontainers that build and run a WebHare source checkout (usually a git worktree) so changes can be tested in isolation",
  subCommands: {
    "create": {
      shortDescription: "Create and start a container for a checkout",
      flags: {
        "privileged": "Run the container in privileged mode",
        "force": "Allow using the checkout this WebHare runs from",
        "writable-git": "Mount a worktree's main repository .git directory read-write instead of read-only, so git commands inside the container can change the repository",
      },
      options: {
        "image": { description: "Container image to use", default: defaultImage },
        "module": { description: `Module to mount in ${modulesRootInContainer}, as a path or the name of a module installed in this WebHare`, multiple: true },
      },
      arguments: [
        { name: "<name>", description: "Container name", type: containerNameArg },
        { name: "<checkout>", description: "WebHare source checkout to mount, usually a git worktree" },
      ],
      async main({ args, opts }) {
        if (listContainers().some(container => container.name === args.name))
          throw new CLIRuntimeError(`A devkit container named '${args.name}' already exists`);
        if (runPodman(["image", "exists", opts.image], { allowFail: true }).status !== 0)
          throw new CLIRuntimeError(`Image ${opts.image} not found, build it first using addons/docker-build/build-devcontainer.sh`);

        const { checkout, gitCommonDir } = prepareCheckout(args.checkout, { force: opts.force });
        const modules = opts.module.map(resolveModule);
        const duplicate = modules.find((module, idx) => modules.findIndex(other => other.name === module.name) !== idx);
        if (duplicate)
          throw new CLIRuntimeError(`Module '${duplicate.name}' was specified more than once`);
        const hostPort = allocateHostPort();
        const volume = prepareVolume(args.name, opts.image);

        const createArgs = [
          "create",
          "--name", containerPrefix + args.name,
          "--hostname", containerPrefix + args.name,
          "--label", `${labelPrefix}.name=${args.name}`,
          "--label", `${labelPrefix}.checkout=${checkout}`,
          "--label", `${labelPrefix}.hostport=${hostPort}`,
          "--label", `${labelPrefix}.modules=${JSON.stringify(modules)}`,
          "--security-opt", "label=disable",
          "-e", "WEBHARE_RESCUEPORT_BINDIP=0.0.0.0",
          "-p", `127.0.0.1:${hostPort}:13679`,
          "-v", `${checkout}:${sourceRootInContainer}`,
          ...(gitCommonDir ? ["-v", `${gitCommonDir}:${gitCommonDir}${opts.writableGit ? "" : ":ro"}`] : []),
          ...modules.flatMap(module => ["-v", `${module.root}:${path.posix.join(modulesRootInContainer, module.name)}`]),
          ...volumeMounts.flatMap(mount => ["--mount", `type=volume,src=${volume},dst=${mount.target},subpath=${mount.subpath}`]),
          "-v", `${buildRootVolume}:/opt/whbuildroot`,
          ...(opts.privileged ? ["--privileged"] : []),
          opts.image,
          "sleep", "infinity",
        ];
        runPodman(createArgs);
        await startContainer(getContainer(args.name));

        console.log(`Created devkit container '${args.name}' for ${checkout}`);
        console.log(`Build WebHare:  wh devkit:container exec ${args.name} wh make install`);
        console.log(`Start WebHare:  wh devkit:container console ${args.name}`);
        console.log(`Rescue port:    http://127.0.0.1:${hostPort}/`);
      }
    },
    "list": {
      shortDescription: "List devkit containers",
      flags: { "json": "Output as JSON" },
      async main({ opts }) {
        const containers = await Promise.all(listContainers().map(async container => ({
          ...container,
          watcher: await isWatcherRunning(container.name) ? "running" : "stopped",
          rescueURL: `http://127.0.0.1:${container.hostPort}/`,
        })));
        if (opts.json) {
          console.log(JSON.stringify(containers, null, 2));
          return;
        }
        if (!containers.length) {
          console.log("No devkit containers. Create one with 'wh devkit:container create <name> <checkout>'");
          return;
        }
        console.table(containers.map(container => ({ name: container.name, state: container.state, watcher: container.watcher, rescue: container.rescueURL, checkout: container.checkout, modules: container.modules.map(module => module.name).join(", ") })));
      }
    },
    "start": {
      shortDescription: "Start a container and its file watcher",
      arguments: [{ name: "<name>", description: "Container name", type: containerNameArg }],
      async main({ args }) {
        await startContainer(getContainer(args.name));
      }
    },
    "stop": {
      shortDescription: "Stop a container and its file watcher",
      arguments: [{ name: "<name>", description: "Container name", type: containerNameArg }],
      async main({ args }) {
        const container = getContainer(args.name);
        await stopWatcher(container.name);
        if (container.state === "running")
          runPodman(["stop", "-t", "30", container.containerName]);
      }
    },
    "remove": {
      shortDescription: "Remove containers",
      description: "Remove all containers whose name matches the mask, which may contain '*' and '?' wildcards. Refuses to remove running containers unless --force is given. Their volumes are removed too, unless --keep-volumes is given. The checkouts are never touched",
      flags: {
        "f,force": "Also remove containers that are running",
        "keep-volumes": "Keep their volumes (database, build directory, node_modules), so a container created with the same name reuses its volume",
        "v,verbose": "Report each step before taking it",
      },
      arguments: [{ name: "<mask>", description: "Container name or wildcard mask, eg. 'feature-*'" }],
      async main({ args, opts }) {
        const verbose = (message: string) => opts.verbose && console.log(message);
        const mask = regExpFromWildcards(args.mask);
        const containers = listContainers().filter(container => mask.test(container.name));
        if (!containers.length)
          throw new CLIRuntimeError(`No devkit containers match '${args.mask}', see 'wh devkit:container list'`);
        // Anything but a fully stopped container counts as running, including one that's starting, stopping or paused
        const running = containers.filter(container => !stoppedStates.includes(container.state));
        if (running.length && !opts.force)
          throw new CLIRuntimeError(`Not removing anything, these containers are running: ${running.map(container => `'${container.name}' (${container.state})`).join(", ")}. Stop them first, or use --force`);

        for (const container of containers) {
          verbose(`Stopping the file watcher for '${container.name}'`);
          await stopWatcher(container.name);
          verbose(running.includes(container) ? `Shutting down and removing container '${container.containerName}' (${container.state})` : `Removing container '${container.containerName}' (${container.state})`);
          runPodman(["rm", "-f", "-t", "30", container.containerName]);
          rmSync(getWatcherFiles(container.name).logFile, { force: true });
          if (!opts.keepVolumes) {
            verbose(`Removing volume '${getVolumeName(container.name)}'`);
            runPodman(["volume", "rm", "-f", getVolumeName(container.name)], { allowFail: true });
          }
          console.log(`Removed devkit container '${container.name}'${opts.keepVolumes ? "" : " and its volume"}. The checkout ${container.checkout} has not been touched`);
        }
      }
    },
    "exec": {
      shortDescription: "Run a command in a container",
      description: "Run a command in a container, in the source root (/opt/wh). Starts a login shell if no command is given",
      flags: { "no-tty": "Don't allocate a terminal, even if we're running in one" },
      mixedFlags: false, //so options after the command name are passed to the command
      arguments: [
        { name: "<name>", description: "Container name", type: containerNameArg },
        { name: "[command...]", description: "Command and arguments" },
      ],
      async main({ args, opts }) {
        const command = args.command.length ? args.command : ["bash", "-l"];
        return await execInContainer(getContainer(args.name), command, opts.noTty ? { tty: false } : {});
      }
    },
    "console": {
      shortDescription: "Run WebHare in a container",
      description: "Run 'wh console' in a container. With --detach, WebHare runs in the background. Its output is in the servicemanager log ('wh catlog servicemanager')",
      flags: { "detach": "Run in the background" },
      arguments: [{ name: "<name>", description: "Container name", type: containerNameArg }],
      async main({ args, opts }) {
        const container = getContainer(args.name);
        if (!opts.detach)
          return await execInContainer(container, ["wh", "console"]);

        if (container.state !== "running")
          throw new CLIRuntimeError(`Container '${container.name}' is not running, start it with 'wh devkit:container start ${container.name}'`);
        runPodman(["exec", "-d", "-w", "/tmp", container.containerName, "bash", "-c", "wh console > /dev/null 2>&1"]);
        console.log(`WebHare is starting in '${container.name}'. Follow its output with: wh devkit:container exec ${container.name} wh catlog -f servicemanager`);
      }
    },
  }
});
