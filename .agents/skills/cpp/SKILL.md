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

- `wh execbuilt <binary> [args]` runs a binary from the build directory instead of `whtree/bin/`
  (`wh execbuilt --dbg <binary>` starts it under lldb/gdb).
- `wh usebuiltwasm <command>` runs a command with the HareScript WASM modules from the build directory.

## Verifying

1. Run `wh make` and check that it ends without `Make failed`. Fix compiler warnings in code you touched.
1. Stop WebHare, run `wh make install`, start WebHare again. Or, with the user's approval, `wh -i make install`
   followed by restarting the changed process (eg. `pkill webserver`).
1. Run focused tests for the behavior you changed (see the `running-tests` skill in the `webhare_dev` module).
