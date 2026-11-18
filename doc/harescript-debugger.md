# HareScript debugger
How HareScript jobs are debugged and profiled, and the TypeScript tooling built on it.

## Overview
```
HareScript process (C++)             debug manager                    debuggers
hsvm_debugger.cpp ---------------->  wh:debugmgr_internal             debugger screen (connector.whlib)
                                     debugmgr.whscr          <------  mod::platform/js/hsdebugger (TypeScript)
WASM engine thread  -------------->  (or hsdebugmgr.ts,              ├─ MCP tools (wh devkit:mcp-server)
wasm-debugger.ts                      see below)        wh:debugmgr   ├─ wh debug harescript-agent (stdio)
                                                                      └─ wh debug harescript-dap (VS Code)
```

- Every HareScript process connects to the debug manager's `wh:debugmgr_internal` port when one is running (whmanager
  tells processes whether it is, `have_hs_debugger`). Native processes do this from the C++ debugger thread in
  `harescript/vm/hsvm_debugger.cpp`, the WASM engine from `whtree/jssdk/harescript/src/wasm-debugger.ts` (one connection per
  thread running HareScript scripts).
- The debug manager (`mod::system/scripts/internal/debugmgr.whscr`) keeps track of the processes and their jobs and relays
  the requests of debuggers connected to `wh:debugmgr` to the process running the job.
- Most requests (variables, libraries, debug info, profiles) need the job to be paused.

## TypeScript client
`whtree/modules/platform/js/hsdebugger/` talks to `wh:debugmgr` over the bridge, without a HareScript VM:

- `client.ts`: `HSDebugConnection` lists processes and jobs and attaches to a job (`HSDebugJob`: pause, continue, variables,
  libraries, debug info, handles, profiling, breakpoints). `withPausedJob()` always lets the job continue again.
- `debuginfo.ts`: the debug info of a library (from the job's `getdebuginfo`), used to find the variables of a stack frame
  and the code positions of a line.
- `stack.ts`, `variables.ts`: stack traces with variables, and rendering of variable values.
- `breakpoints.ts`: line breakpoints and stepping in, over and out.
- `profiles.ts`: profiling a job for a while, and the profiles stored by the `apr` debug tag.

Tests: `wh runtest system.debugger.test_hsdebugger`.

## Debugging a WebHare elsewhere
The debug manager can only be reached through the whmanager of the same WebHare, so for a WebHare in a container or on
another machine something has to run there:

- `wh debug harescript-agent` offers the debugger as JSON-RPC (one message per line) on stdin/stdout. Start it with eg
  `podman exec -i <container> wh debug harescript-agent` or `ssh <host> wh debug harescript-agent`. `HSDebugAgentClient`
  (`agentclient.ts`) runs such a command and offers its methods (see `HSDebugAgent.call` in `agent.ts`).
- The MCP server already uses stdio, so AI clients could use the debugging tools of another WebHare by running
  `wh devkit:mcp-server` there. That needs the devkit module, which isn't active in containers (see
  `WEBHARE_ENABLE_DEVKIT` in `gen_config_nodb.ts`); starting a devkit container's WebHare with it currently fails.

## VS Code
`wh debug harescript-dap` is a Debug Adapter Protocol adapter. The WebHare VS Code extension
(`addons/vscode-extension`) registers it for the `harescript` debug type. Example launch configurations:

```json
{
  "type": "harescript",
  "request": "attach",
  "name": "Attach to a HareScript job",
  "script": "myscript.whscr"
}
```

```json
{
  "type": "harescript",
  "request": "attach",
  "name": "Attach to a HareScript job in a container",
  "script": "myscript.whscr",
  "agentCommand": ["podman", "exec", "-i", "wh-devkit-my-feature", "wh", "debug", "harescript-agent"],
  "localRoot": "${workspaceFolder}/",
  "remoteRoot": "/opt/wh/"
}
```

`script` attaches to the newest job whose script contains that text, `groupid` to a specific job. Breakpoints are set on
the libraries the job has loaded; sources that can't be mapped to a local file are shown read-only through the adapter.
Expressions can't be evaluated.

## HareScript in the WASM engine
Scripts running in the WASM engine (eg jobs, and `wh run` of a script with `(*WASMENGINE*)` in its first line or with
`WEBHARE_HARESCRIPT_WASMONLY=1`) are registered with the debug manager by `wasm-debugger.ts` and show up as jobs of a
node process. There's no debugger thread there, so:

- A VM waiting for an async external function (IPC, database, timers) is paused by not letting it continue when the
  function returns.
- Breakpoints and steps stop the VM with a JSPI suspension (`supportDebugStop` in `hsvm_context.cpp`).
- While a debugger is attached, the VM runs in debug mode and gives the event loop a chance to run every 10000
  instructions (`supportDebugPoll`), so a busy VM can be paused too.
- Switching between debug and normal mode (when a debugger attaches, or breakpoints are set) happens at the next call,
  return or jump of the running code.

Not supported for the WASM engine yet: VMs used through `loadlib` (only VMs that run a script are registered), breaking on
exceptions, memory profiles, terminating a job and the rules that attach the debugger to a job when it starts.

## Experimental: TypeScript debug manager
`WEBHARE_HSDEBUGMGR=ts` makes `debugmgr.ts` manage the HareScript processes too (`hsdebugmgr.ts`, a port of
`debugmgr.whscr`) instead of running `debugmgr.whscr`. Values it relays lose the difference between FLOAT and INTEGER when
a float has an integral value, as JavaScript numbers don't keep it.
