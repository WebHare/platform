---
name: cpp
description: "Use when changing, building, or installing the WebHare platform's C++ code (blex, harescript compiler/VM, ap webserver/whmanager/libwebhare, parsers, drawlib) or its WASM build, including 'wh make', 'wh make install', build directories, and C++ test targets."
---

# WebHare C++ codebase

## Layout

The C++ sources live in the repository root, outside `whtree/`:

- `blex/` - base library (sockets, streams, dispatcher, crypto, logging). Generates `blex/platformconf.h` during the
  build; don't edit that file.
- `harescript/` - HareScript compiler (`compiler/`), VM (`vm/`), native HareScript modules (`modules/`) and tests
  (`vmtest/`). The VM is also built as WASM (`lib/harescript.wasm`).
- `ap/` - WebHare application processes: `libwebhare/` (shared webserver/connection code), `webserver/`,
  `whmanager/`, and `utils/` (`runscript`, `whcompile`).
- `parsers/`, `drawlib/` - document parsers and graphics library, loaded as HareScript modules.
- `vendor/` - third-party code (libxml2, njs, dragonbox, fast_float).
- `builder/` - the build system: `make.sh` and `base_makefile`.

## Code that waits inside the VM

Builtin functions run on the VM's thread, so a VM or job can only be aborted (job killed, timeout, shutdown) when the
native code checks for it. Every loop that can wait (`poll`, sleeps, socket/process/database I/O, retry loops) must:

- wait in short slices (eg. `poll(..., 100)`), not one long blocking call,
- keep waiting in slices until the operation is complete: when a slice returns some data, don't hand over to a call
  that blocks until the rest arrives (eg. `PQgetResult` while `PQisBusy` is still true), and
- call `HSVM_TestMustAbort(vm)` after every slice (so at least every ~100ms) and return immediately when it is set.
  Don't throw a HareScript exception in that case: the VM is already being torn down.

Otherwise the VM hangs until the wait ends. Any timeout should count elapsed time, not idle slices, so data that
trickles in can't keep the wait going forever.

## Building: `wh make` and `wh make install`

Builds are done with `wh make`, which runs `builder/make.sh`, which in turn runs GNU make (`gmake` on macOS) on
`builder/base_makefile`. Use the `wh` belonging to the checkout you are building.

1. `wh make` compiles and links everything into the **build directory**, outside the source tree:
   `../whbuild/release-<checkoutdirname>/` (`debug-` with `WHBUILD_DEBUG=1`). It also runs the native test targets
   such as `success.blex`. It does not touch `whtree/`, so a running WebHare keeps using the old binaries. You can run
   it while WebHare is running: use it to check that your change compiles.
1. `wh make install` builds and then copies the binaries, libraries and WASM files into `whtree/` (`bin/`, `lib/`),
   and runs the postinstall step (`wh finalize-webhare`) when its inputs changed. It refuses to run while WebHare is
   running ("WebHare is already running"): stop WebHare first, then restart it after the install.
   Only after `wh make install` do your changes take effect in WebHare.
1. To install while WebHare keeps running, use `wh -i make install` (`-i`/`--ignore-running` skips the running
   check). This overwrites binaries in use by the running WebHare, so **ask the user for approval first**. Running
   processes keep the old code until restarted: after a webserver change, `pkill webserver` makes WebHare restart the
   webserver with the new binary.

Notes:

- `wh make` takes make targets as arguments: `wh make list-targets` lists them. Single binaries and libraries can be
  built by name, eg. `wh make webserver` (build only) or `wh make webserver-install` (copy that one binary into
  `whtree/bin/`).
- `make.sh` checks Homebrew packages (macOS) and the emsdk on each run. `WHBUILD_FASTMAKE=1` skips the package check
  and version reporting.
- `wh fixbuild` (WebHare stopped) updates git submodules and does a clean rebuild and install. Use it when the build
  breaks for reasons unrelated to your change, eg. after a non-recursive update or an emscripten update.
- Build output is cached with ccache in `../whbuild/ccache`.

## Testing a change before installing

`wh runtest`, `wh run` and the running WebHare use the *installed* binaries and libraries, so they keep running the
old code until the build is installed. Don't install just to test: run the built code directly instead.

### Native engine: `wh execbuilt`

`wh execbuilt <binary> [args]` runs a binary from the build directory's `bin/` instead of `whtree/bin/`, with
`--moduledir` pointing to the build directory's `lib/`. `wh execbuilt --dbg <binary>` starts it under lldb (macOS) or
gdb (Linux).

When the code runs inside the `runscript` process (the HareScript compiler and VM, library loading and path
resolution, builtin functions in `ap/libwebhare` and `harescript/`), run a script with the built `runscript`:

```bash
wh make
wh execbuilt runscript mod::webhare_testsuite/tests/baselibs/hsengine/test_loadlib.whscr
```

- The script can be a resource path (`mod::...`) or a disk path. Use the exit code to tell whether it passed: a
  passing HareScript test usually prints nothing.
- `TestCompile` and `TestCompileAndRun` from `wh::internal/hsselftests.whlib` compile in-process, so compiler and
  `LOADLIB` changes are covered as well.
- If even a trivial script fails with `Cannot find compiled version of library` for a standard library such as
  `mod::system/lib/...`, the change has probably broken library path resolution. The installed build is not affected.

### WASM engine: `wh usebuiltwasm`

Many HareScript tests also run on the WASM engine: check the test's `testinfo.xml` for a `<group engine="wasm">` that
lists it. In the WASM build, library resolution and loading are implemented in TypeScript
(`whtree/jssdk/harescript/src/wasm-modulesupport.ts`), not in `ap/libwebhare/wh_filesystem.cpp`, so a change there
needs a matching TypeScript change.

`wh usebuiltwasm <command>` runs a command with `WEBHARE_WASMMODULEDIR` pointing to the WASM modules in the build
directory. To run a script on the built WASM engine:

```bash
wh usebuiltwasm wh runwasm mod::webhare_testsuite/tests/baselibs/hsengine/test_loadlib.whscr
```

TypeScript changes take effect without a build.

### Limits

Code that runs in other processes of the running WebHare (services and the webserver) still uses the installed
binaries. Testing that requires installing the build (see above). `WHBUILD_DEBUG=1` also selects the debug build for
`wh execbuilt` and `wh usebuiltwasm`.

## Verifying

1. Run `wh make` and check that it ends without `Make failed`. Fix compiler warnings in code you touched.
1. Stop WebHare, run `wh make install`, start WebHare again. Or, with the user's approval, `wh -i make install`
   followed by restarting the changed process (eg. `pkill webserver`).
1. Run focused tests for the behavior you changed (see the `running-tests` skill in the `webhare_dev` module).
