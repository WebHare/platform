---
name: devkit-containers
description: "Use when building, running or testing WebHare platform changes from a git worktree in an isolated Linux container with wh devkit:container (create, exec, console, start, stop, remove, list), eg. to run wh make install, wh console or wh runtest for a feature branch without touching the host's own WebHare, or when file changes don't seem to reach a devkit container."
---

# Testing a worktree in a devkit container

`wh devkit:container` runs a WebHare source checkout, usually a git worktree, inside a long-running podman container
based on the devcontainer image. Use it to build and test a branch without touching the WebHare installation the host
runs from. [doc/devkit-containers.md](../../../doc/devkit-containers.md) describes how containers are set up; this skill
is the workflow.

Run `wh devkit:container` with the **host's** `wh` (through runkit if that's how this session invokes `wh`). It manages
podman on the host, and its subcommands run commands inside the container for you.

## 1. Check prerequisites

1. `podman machine list` must show a running machine. If not, ask the user to start it.
1. `podman image exists localhost/webhare/platform:devcontainer` must succeed. If not, build the image from the
   worktree with `addons/docker-build/build-devcontainer.sh`. This takes a while; run it in the background.
1. Check for an existing container for the worktree with `wh devkit:container list` and reuse it (`start` it if it's
   stopped) instead of creating a second one.

## 2. Create the container

```bash
git worktree add .claude/worktrees/<topic> feature/<topic>   # if the worktree doesn't exist yet
wh devkit:container create <name> .claude/worktrees/<topic>
```

`create` initializes the worktree's submodules on the host, creates the container and starts it together with a file
watcher on the host. Never use the checkout the host's WebHare runs from: the build writes Linux binaries into it.
`create` refuses it unless you pass `--force`, which you shouldn't.

### Mounting modules
To test a module against the worktree's WebHare, add `--module <module>` (repeatable). Pass a path to the module, or
the name of a module installed in the host's WebHare to mount the directory it's installed from. Modules are mounted in
`/opt/whmodules/<module>`, and the watcher forwards changes in them like changes in the worktree. Check that WebHare
finds a module with `wh devkit:container exec --no-tty <name> wh getmoduledir <module>`. Like `--writable-git`, modules
can only be chosen at `create` time.

### Git inside the container
A worktree's `.git` is a file pointing into the main repository's `.git` directory. `create` mounts that directory
read-only at its host path: `wh make install` needs git to record the commit, branch and origin in its build info, and
fails without it. Git commands that only read (`log`, `show`, `rev-parse`, `diff`) work inside the container; anything
that writes (commit, checkout, branch) fails. `git status` inside the container doesn't work either, because the
submodules' `.git` files hold relative paths that only resolve on the host.

Do all git work on the host, in the worktree: the container sees the same files. Pass `--writable-git` only if
something inside the container must change the repository. Anything run in the container can then change your
repository's branches, index and objects. It can only be chosen at `create` time; to change it, `remove` and `create`
the container again (`remove --keep-volumes` keeps the build and database).

## 3. Build and run WebHare

Use `--no-tty` for every `exec` and `console` call: an agent's shell may look like a terminal but can't interact with
one. Long-running commands should write their output to a file inside the container, so it survives if your session or
the command's process on the host ends:

```bash
wh devkit:container exec --no-tty <name> bash -c 'wh make install > /opt/whdata/make.log 2>&1; echo "make exit=$?" >> /opt/whdata/make.log'
wh devkit:container exec --no-tty <name> tail -5 /opt/whdata/make.log
```

The first build compiles everything and takes 10 minutes or more; later builds are incremental.

Start WebHare in the background and wait for it:

```bash
wh devkit:container console --detach <name>
wh devkit:container exec --no-tty <name> wh waitfor poststartdone
wh devkit:container exec --no-tty <name> bash -c 'wh catlog servicemanager | tail -20'
```

`wh devkit:container list` shows the rescue port URL (`http://127.0.0.1:<port>/`) to reach this WebHare from the host.

## 4. Test changes

- Run tests inside the container: `wh devkit:container exec --no-tty <name> wh runtest <test>`.
- Edit files on the host, in the worktree. While WebHare runs in the container, the watcher reports changed, new and
  deleted files to its `watchsourcefiles` service with `wh event invalidate-file`, so WebHare reacts as it would on a
  local install (services restart, siteprofiles recompile).
- A worktree whose branch predates `wh event invalidate-file` won't pick up changes made on the host. Rebase it onto a
  newer main, or restart the affected services yourself.
- C++ changes, changed dependencies and other build changes need `wh make install` again. Stop WebHare first
  (`wh devkit:container exec --no-tty <name> wh service shutdown` or stop and start the container).

If WebHare doesn't pick up a change, check whether `list` shows the watcher as running (`start` restarts it) and its
log in `$TMPDIR/wh-devkit/<name>.watcher.log` on the host.

## 5. Clean up

- `wh devkit:container stop <name>` stops the container and its watcher. `start <name>` resumes it; WebHare itself
  must be started again with `console`.
- `wh devkit:container remove <name>` removes the container and its volumes: its database, build directory and
  `node_modules`. Add `--keep-volumes` to keep them for a container you'll create again with the same name. The worktree is never touched; remove it with `git worktree remove`
  when the user agrees.

## Troubleshooting

- **`configure: error: newly created file is older than distributed files`**, or make rebuilding everything: the podman
  VM's clock is behind the host's (`create` and `start` warn about this). Fix it with
  `podman machine ssh "sudo date -u -s @$(date +%s)"` and build again. If the warning says the machine runs a Podman 5
  OS, tell the user it can be fixed for good with `podman machine os apply` (the warning has the exact command). Don't
  run it yourself: it restarts the machine and stops every container in it.
- **`Library modified during compilation process`** during `wh make install`: something compiled HareScript while the
  build was precompiling. Don't run other `wh` commands in the container during a build, then build again.
