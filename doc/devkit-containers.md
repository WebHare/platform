# Devkit containers
Devkit containers let you build and run a WebHare source checkout, usually a git worktree, inside a Linux container
without touching the WebHare installation you normally develop with. Use them to test a branch in isolation, or to let an
AI agent build and test its changes in a worktree while your own WebHare keeps running.

Devkit containers are managed with `wh devkit:container` from your own (host) WebHare. Unlike the containers started by
`addons/docker-build/run-devcontainer.sh` they keep running in podman until you stop them, and they keep their database,
build directory and `node_modules` in a volume, so rebuilds are incremental.

## Requirements
- [podman](https://podman.io/), with a running podman machine on macOS
- The devcontainer image. Build it from your checkout with `addons/docker-build/build-devcontainer.sh`, and rebuild it
  when the build prerequisites (eg. the Node or Emscripten version) change

## Quick start
```bash
# Create a worktree for the branch you want to test
git worktree add .claude/worktrees/my-feature feature/my-feature

# Create and start a container for it
wh devkit:container create my-feature .claude/worktrees/my-feature

# Build WebHare inside the container
wh devkit:container exec my-feature wh make install

# Run WebHare inside the container, in the foreground...
wh devkit:container console my-feature
# ...or in the background
wh devkit:container console --detach my-feature
wh devkit:container exec my-feature wh catlog -f servicemanager

# Open a shell, or run any other command
wh devkit:container exec my-feature
wh devkit:container exec my-feature wh runtest system.nodejs.test_rtd
```

Other subcommands:
- `list` shows all devkit containers, whether they and their file watcher are running, and their rescue port URL
- `stop <name>` and `start <name>` stop and restart a container. Its volume is kept
- `remove <mask>` removes the containers whose name matches the mask, which may contain `*` and `?` wildcards (eg.
  `wh devkit:container remove 'feature-*'`). If any of them is running, nothing is removed unless you add `--force`.
  Their volumes (database, build directory and `node_modules`) are removed too, unless you add `--keep-volumes`. A
  container created later with the same name then reuses its volume. Add `--verbose` to see each container and volume before
  it's removed. The checkout itself is never touched

Commands like `exec` pick up whether they're running in a terminal. Scripts and AI agents that run in a terminal but
can't interact with it should pass `--no-tty`.

## How a container is set up
- The checkout is mounted at `/opt/wh`, where the devcontainer image expects it
- A git worktree's `.git` is a file pointing into the main repository's `.git` directory. That directory is mounted
  read-only at its host path, as `wh make install` needs git to generate its build info. Pass `--writable-git` to
  `create` to mount it read-write instead, so git commands inside the container can commit or otherwise change your
  repository
- Modules passed with `--module` are mounted in `/opt/whmodules/<module>`, where WebHare finds them through
  `WEBHARE_MODULEPATHS`. Pass a path to the module, or the name of a module installed in the WebHare you run
  `wh devkit:container` from to mount that module's directory. Repeat the option to mount several modules
- Git submodules are initialized on the host when the container is created. The container has no credentials to clone
  them, and a submodule cloned inside the container records paths that don't work on the host
- Each container gets its own volume, `wh-devcontainer-<name>`. Its subfolders are mounted as `/opt/whdata` (database
  and other data), `/opt/whbuild` (build directory), `whtree/node_modules` (Linux binaries) and `whtree/currentinstall`.
  The `wh-devkit-buildroot` volume with ccache and downloaded build dependencies is mounted as `/opt/whbuildroot` and
  shared between all devkit containers. `remove` never removes it
- The rescue port (13679) is published on `127.0.0.1`, starting at host port 14700 and counting up by 10 for each
  container
- Containers are labeled `dev.webhare.devkit-container.*` with their name, checkout and port. `podman ps -a --filter
  label=dev.webhare.devkit-container.name` lists them

`wh make install` writes Linux binaries into the checkout's `whtree/bin` and `whtree/lib`. A checkout built in a container
can't be used for a WebHare running on macOS, which is why `create` refuses the checkout your own WebHare runs from.

## File changes
WebHare's `watchsourcefiles` service uses `inotifywait` to notice changed HareScript libraries, siteprofiles, module
definitions and other resources. On macOS, a change made on the host to a file in a podman bind mount does **not**
generate an inotify event inside the container. Only changes made inside the container do. Without help, a WebHare
running in the container won't notice edits you (or your editor, or an agent on the host) make to the worktree.

`create` and `start` therefore also start a watcher on the host that forwards these changes. It watches the checkout
and any mounted modules, and reports changed, new and deleted files with `wh event invalidate-file` inside the container.
`watchsourcefiles` then processes them exactly as if `inotifywait` had reported them. The watcher skips git-ignored
files (build output), `.git` and the directories that live in volumes. It only reports changes while WebHare is running
in the container: a WebHare that's starting up reads the current files anyway.

`wh event invalidate-file` was added together with devkit containers. A checkout from before that can't receive
changes made on the host; rebase or merge it onto a newer main.

The watcher is `mod::devkit/scripts/libexec/container-watcher.ts`. It exits by itself when its container stops or is
removed, and listens on a unix socket in the user's temporary directory (`$TMPDIR/wh-devkit/<name>.sock`) that
`wh devkit:container` uses to check whether it's running and to stop it. Its log is next to the socket, in
`$TMPDIR/wh-devkit/<name>.watcher.log`. To debug it, stop the background watcher with
`echo stop | nc -U $TMPDIR/wh-devkit/<name>.sock` and run
`wh run mod::devkit/scripts/libexec/container-watcher.ts <name>` in the foreground.

Changes made inside the container (eg. by `wh devkit:container exec`) don't need the watcher.

## Troubleshooting
### "newly created file is older than distributed files" or make rebuilding everything
The podman machine's clock can fall behind the host's after the Mac sleeps. Files in the checkout then get host timestamps
and files in volumes get the VM's, which breaks `configure` scripts and make. `create` and `start` warn when the clocks
differ by more than a few seconds. To fix the clock:

```bash
podman machine ssh "sudo date -u -s @$(date +%s)"
```

Podman 6 keeps the machine's clock in sync with the host, but only if the machine's OS is also version 6. A machine
created with Podman 5 keeps its 5.x OS when you upgrade podman, and `podman machine os upgrade` can't take it from 5 to 6
([podman#29034](https://github.com/podman-container-tools/podman/issues/29034)). `create` and `start` tell you when that's
the case. Apply the new OS yourself (this restarts the machine, stopping all its containers), using the host's podman
version:

```bash
podman machine os apply quay.io/podman/machine-os:6.1 --restart
```

### Image not found
Build the image with `addons/docker-build/build-devcontainer.sh`. `create` uses `localhost/webhare/platform:devcontainer`
unless you pass `--image`.
