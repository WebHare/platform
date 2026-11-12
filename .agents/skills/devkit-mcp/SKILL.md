---
name: devkit-mcp
description: "Use when working on or debugging the devkit MCP server (`wh devkit:mcp-server`, whtree/modules/devkit/js/mcp-server/), how it offers webhare.dev AI skills to clients (wh_get_skill tool, skill:// resources, prompts), its HareScript job debugging and profiling tools (wh_debug_* tools: jobs, stacks, variables, handles, locks, function profiles), or the devkit:integrations.* registry keys that control where those skills come from."
---

# devkit MCP server

The devkit module ships an MCP server that AI clients (Claude Code, VS Code, ...) connect to over stdio:

```
runkit wh devkit:mcp-server
```

WebHare's VS Code extension registers it automatically. Code:

- `whtree/modules/devkit/scripts/whcommands/mcp-server.ts` - CLI entrypoint
- `whtree/modules/devkit/js/mcp-server/server.ts` - MCP server setup and request handlers. The server deliberately offers no tools to run commands: clients run `wh` themselves using the command line from the server instructions (eg `wh getmodulelist`, `wh isrunning`)
- `whtree/modules/devkit/js/mcp-server/skills.ts` - skill sources (local/remote) and how skills are exposed
- `whtree/modules/devkit/js/mcp-server/debugger.ts` - tools to inspect running HareScript jobs, see [Debugging tools](#debugging-tools)
- `whtree/modules/devkit/js/mcp-server/profiles.ts` - tools to capture and query HareScript function profiles, see [Profiling tools](#profiling-tools)
- `whtree/modules/devkit/js/mcp-server/jobdebuggerlib.ts` - calls into `mod::devkit/lib/internal/jobdebugger.whlib` on the tools' own HareScript VMs

The server instructions tell the client which WebHare it is connected to: version, server name, backend URL, installation root, data root and the exact command line to invoke `wh`. When started through runkit, that's `<runkit> @<target> wh` (from `WHRUNKIT_ORIGCOMMAND`/`WHRUNKIT_TARGETSERVER`), as a bare `bin/wh` needs runkit's environment; otherwise it's `<installationRoot>bin/wh`.

The server logs to stderr (stdout is the MCP protocol). On startup it logs `Skills: <location>` showing which skill source is used.

## Debugging tools

Added in WebHare 6.2.0. These are the exception to "no tools to run commands": they offer what the HareScript debugger screen shows, with output suited to a model. Check availability by looking for them in `tools/list`. (`wh harescript-debug` has command line versions of some of them, eg `stacktrace`, `jobhandles` and `locks`.)

- **`wh_debug_list_jobs`** (optional `filter`) - lists the HareScript jobs known to the debug manager: group id, script, status, start time, running time, process and context info. `filter` matches script, status, group id or context info, case-insensitively. Services started through `servicerunner->AddScript("lib#Function")` (eg the cluster services) are listed as `wh::internal/asyncrunner.whscr`; the variables of their outermost frame (`MSG.FUNC`) name the service.
- **`wh_debug_get_job_stack`** (`groupid`, optional `variables`, `depth`, `timeout`) - pauses the job, reads its stack trace and resumes it. `variables` lists frame indices (0 = innermost) to also show the local variables of; they're read during the same pause, so frame numbers can't shift. `depth` (default 2, max 6) limits how far records, objects and arrays are expanded. `timeout` (ms, default 5000, max 30000) limits the wait for the pause. Fails if a debugger (eg the debugger screen) is already connected to the job.
- **`wh_debug_get_job_handles`** (`groupid`, optional `timeout`) - pauses the job and lists its open handles (pipes, IPC links and ports, event streams...). The names are generic, eg 'IPC link endpoint'; use the stack variables to see which port a link belongs to.
- **`wh_debug_list_locks`** - lists the cluster mutexes from the mutex manager (`listLocks()` in `@mod-platform/js/bridge/tools`, also used by `wh debug get-locks`) with their holders and waiters, plus the job locks inside each HareScript process. A cluster mutex first takes a process-local job lock named `mutex:<name>`; those are only shown when a job is waiting for them, as they otherwise duplicate the cluster list. Database locks aren't included (use `pg_stat_activity` / `pg_blocking_pids()`).

The tools call `mod::devkit/lib/internal/jobdebugger.whlib` through `jobdebuggerlib.ts`, which uses its own VMs (`createVM`) rather than `loadlib`: a HareScript error can shut a VM down, and the code context VM behind `loadlib` isn't replaced after that. The shared VM is replaced after any error; job profiling gets a VM of its own so it doesn't block the other tools while it waits. That library wraps `mod::system/lib/internal/debugger/connector.whlib`, the API the debugger screen (`mod::system/lib/screens/debugger/debugger.whlib`) uses to talk to the debug manager (`wh:debugmgr`); there is no TypeScript client for it. Things to keep in mind when changing it:

- `WithPausedJob` always resumes a job it paused, also on errors. If the pause times out it sends a continue, then waits another 2 seconds and continues again if the pause arrives late.
- Variables are located like the debugger screen does: `CompiledLibrary->GetFrameVariables()` maps the frame's `codeptr`/`baseptr` to variable ids using the compiled library on disk. If the library was recompiled after the job loaded it (different `compile_id`), the variables can't be located and the tool says so.
- The job only sends one level of nested values. `ExpandValue` requests more (`GetVariables` with the value's `id` and `max`, as the screen does when a node is expanded), up to `depth`, at most 50 items per container and 200 extra requests per call, as each request is a round trip while the job is paused. `ExternVariable` (from the debugger screen) formats the values.

- Profiling requests (`SetProfiling`, `GetProfile`) are only accepted while the job is paused. Otherwise the C++ debugger (`harescript/vm/hsvm_debugger.cpp`) answers `error-notstopped`, which doesn't resolve the request's promise, so `AwaitRequest` adds a timeout.

JavaScript processes aren't covered; they have their own debug manager (`ts:debugmgr`, see `wh debug`).

## Profiling tools

Added in WebHare 6.2.0, like the debugging tools. Profiles are too big to return as a whole, so the server keeps them for its lifetime (`ProfileStore` in `profiles.ts`) and the tools query them. The sources match the debugger and the profiler app (`mod::system/lib/screens/debugger/profiles.whlib`):

- **`wh_debug_profile_job`** (`groupid`, optional `duration` in ms, default 5000, max 60000) - pauses the job, enables function profiling, lets it run for `duration`, pauses it again and reads the profile. Returns a `job-<n>` id and the top functions by self time.
- **`wh_debug_profile_listener`** (`action`: `start`, `stop` or `status`) - registers the global `system:profiles` port, like the profiler app's 'live' session, and keeps the last 200 reported profiles as `live-<n>`. They're sent by `ReportFunctionProfile` (`wh::devsupport.whlib`), eg by tests run with profiling, profiled managed tasks, and requests and RPCs with the `apr` debug option. Only one listener can be registered, so this fails while the profiler app is listening.
- **`wh_debug_list_profiles`** (optional `session`, `filter`, `limit`) - lists captured and live profiles, and the profiles stored in `caches/platform/hs-profiles/<session>/` (default session `default`) as `stored:<session>/<file>`. HareScript scripts store their profile there when they end while the `apr` debug tag is set (`wh harescript-debug setconfig apr`, see `preload.whlib`). Only the first line of each file (a JSON header) is read for the list.
- **`wh_debug_profile_functions`** (`profile`, optional `sort`: `self`, `total` or `calls`, `limit`, `filter`) - the top functions, each with a numeric function id (its profile location).
- **`wh_debug_profile_function`** (`profile`, `function` id or exact name, optional `limit`) - one function with its callers and callees.

The analysis (`analyseProfile`) follows `DisplayedFunctionProfile` in `mod::system/lib/internal/debugger/profilingsupport.whlib`: raw items are (parent location, location) pairs; per function, total time is the sum of `totaltime_callee_nr` (recursion counted once) and the caller/callee lists use the summed `totaltime` per pair. Only function profiles can be analysed; memory profiles are listed but refused.

## Skills

The server offers the AI skills maintained in the webhare_dev module (`content/ai/skills/<skill>/SKILL.md`, with `name` and `description` YAML frontmatter plus optional supporting files). MCP has no native skills concept, so they are exposed in several ways:

- **`wh_get_skill` tool** - its description lists all skills with their descriptions, so the model knows when to load one. Takes `name` and an optional `file` (default `SKILL.md`) for supporting files.
- **Resources** - every skill file as `skill://<name>/<file>`. Clients can subscribe to get `notifications/resources/updated`.
- **Prompts** - every skill as a prompt (in Claude Code: `/mcp__<server>__<skill>`).
- **Server instructions** - only point to `wh_get_skill`. They don't contain the skill list or where the skills come from, because instructions are only sent once, at `initialize`.

When skills change, the server sends `tools/list_changed`, `resources/list_changed` and `prompts/list_changed`. Putting the skill list in the tool description so it can be refreshed is **speculative**: it has not been verified that clients actually refresh the tool definitions in the model's context mid-session. See the comment in `skills.ts` before reworking this.

Only files listed for a skill are served, which prevents path traversal (eg `skill://wrd/../modules/SKILL.md` is refused).

## Registry keys

Both live in `devkit:integrations` (declared in `whtree/modules/devkit/moduledefinition.xml`). The server subscribes to registry changes for these keys (`getRegistryKeyEventMasks` + `subscribe`) and switches skill source on the fly, sending the list_changed notifications. Where the skills come from is therefore described in the `wh_get_skill` tool description (which clients can refresh), not in the server instructions (which are only sent once).

| Key | Default | Effect |
|---|---|---|
| `devkit:integrations.use_checkedout_site` | `true` | Use the skills from the locally installed webhare_dev module (`backendConfig.module["webhare_dev"].root` + `content/ai/skills/`). If the module or folder isn't there, the server falls back to the remote site and says why in the `wh_get_skill` description. |
| `devkit:integrations.webhare_dev_site` | `https://www.webhare.dev/` | Site to fetch skills from when not using the local checkout. The server reads `<site>ai/index.json` and fetches files from `<site>ai/<skill path>/<file>`. |

```bash
wh registry get devkit:integrations.use_checkedout_site
wh registry set devkit:integrations.use_checkedout_site false
```

If the keys don't exist yet after changing the module definition, run `wh apply registry --modules devkit`.

### Local mode

- Skills are read from disk on every request, so edits are visible immediately.
- The folder is watched with a recursive `fs.watch` (changes are batched for 250ms). Changes trigger the list_changed notifications and `resources/updated` for subscribed files. A skills folder that appears after startup is not picked up until a restart.
- The `wh_get_skill` description tells the model the exact skills directory, so it can create or edit skills there when the user asks.

### Remote mode

- `ai/index.json` is fetched at startup and every 15 minutes. If it changed, list_changed notifications are sent (no `resources/updated`, as the index doesn't say which files changed). If a fetch fails, the last good index is kept.
- Skill files are fetched on demand. The `wh_get_skill` description says these are read-only published copies.

## ai/index.json

Generated by webhare_dev's `scripts/tasks/import-repo.ts` (task `webhare_dev:import_repo`), which `scripts/tasks/update-from-github.ts` schedules when it pulls a new commit. The import mirrors the checkout's `content/` folder to `storage::webhare_dev/site/` with all folder and file names lowercased (the webserver folds requested URLs to lowercase) and writes `storage::webhare_dev/site/ai/index.json`, which the site serves as `/ai/index.json`. The index keeps the original case of paths and file names, eg `SKILL.md`:

```json
{
  "version": 1,
  "commit": "<git commit of the checkout>",
  "skills": [
    { "name": "wrd", "description": "...", "path": "skills/wrd", "files": ["SKILL.md"] }
  ]
}
```

`path` is relative to `content/ai/` (and to `<site>ai/`), `files` relative to the skill directory. Bump `version` on incompatible changes; the MCP server rejects versions it doesn't know.

## Testing

Pipe JSON-RPC messages into the server and keep stdin open long enough for responses:

```bash
( printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"wh_get_skill","arguments":{"name":"wrd"}}}'
  sleep 5 ) | wh devkit:mcp-server
```

To test change notifications in local mode, touch or add a file in the skills folder while the server runs.

To test the debugging tools, call `wh_debug_list_jobs` (eg with `{"filter":"asyncrunner"}`), then `wh_debug_get_job_stack` with one of the returned group ids and eg `"variables":[2],"depth":3`. Then call `wh_debug_list_jobs` again and check that the job is back in its normal status (eg `WaitForMultiple`, not `DebugStopped`) and isn't connected anymore. To test job profiling, run a HareScript script with a busy loop for a minute (`wh run`), then call `wh_debug_profile_job` on its job and check that the job continues running afterwards. To test the live listener, start it, run a script that calls `EnableFunctionProfile()`, does some work and calls `ReportFunctionProfile("test", "test")` (`wh::devsupport.whlib`), then check that the profile is listed and can be queried. To test `wh_debug_list_locks`, run a script holding a mutex (`OpenLockManager()->LockMutex("devkit:test")` from `mod::system/lib/internal/cluster/lockmanager.whlib`, followed by a `Sleep()`) twice, so one holds the mutex and the other waits for it.
