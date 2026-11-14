---
name: testing-cpp-changes
description: "Use when testing changes to WebHare's C++ code (ap/, harescript/, blex/) such as the HareScript VM, compiler, or libwebhare, before they are installed. Covers wh make, wh execbuilt runscript and wh usebuiltwasm."
---

# Testing C++ changes without installing them

`wh runtest`, `wh run` and the running WebHare use the *installed* binaries and
libraries. After changing C++ code, they keep running the old code until the
build is installed. Don't install just to test: that replaces the binaries of the
running WebHare.

## Build

Run `wh make`. This compiles the C++ libraries and binaries (native and WASM)
into the build directory without installing them. It prints
`Nothing to be done for 'all'` when the build is already up to date.

## Run a HareScript script with the built code

When the code you're testing runs inside the `runscript` process (the HareScript
VM, library loading and path resolution, builtin functions in `ap/libwebhare` and
`harescript/`), run the script directly with the built `runscript`:

```bash
wh make
wh execbuilt runscript mod::webhare_testsuite/tests/baselibs/hsengine/test_loadlib.whscr
```

- `wh execbuilt <binary> [args...]` runs `<binary>` from the build directory's
  `bin/` with `--moduledir` pointing to the build directory's `lib/`. The script
  can be a resource path (`mod::...`) or a disk path.
- `wh execbuilt --dbg runscript <script>` starts it under `lldb` (macOS) or
  `gdb` (Linux).
- Use the exit code to tell whether the script passed. A passing HareScript test
  usually prints nothing.
- `TestCompile` and `TestCompileAndRun` from `wh::internal/hsselftests.whlib`
  compile in-process, so compiler and `LOADLIB` changes are covered as well.
- If even a trivial script fails with `Cannot find compiled version of library`
  for a standard library such as `mod::system/lib/...`, the change has probably
  broken library path resolution. The installed build is not affected.

## WASM engine

`wh make` also builds the WASM HareScript engine. Many HareScript tests run on
both engines: check the test's `testinfo.xml` for a `<group engine="wasm">` that
lists it too. In the WASM build, library resolution and loading are implemented
in TypeScript (`whtree/jssdk/harescript/src/wasm-modulesupport.ts`), not in
`ap/libwebhare/wh_filesystem.cpp`, so a change there needs a matching TypeScript
change.

To run a script on the WASM engine with the built WASM modules:

```bash
wh usebuiltwasm wh runwasm mod::webhare_testsuite/tests/baselibs/hsengine/test_loadlib.whscr
```

`wh usebuiltwasm <command>` runs `<command>` with `WEBHARE_WASMMODULEDIR`
pointing to the WASM modules in the build directory. TypeScript changes take
effect without a build.

## Limits

Code that runs in other processes of the running WebHare (services and the
webserver) still uses the installed binaries. Testing that
requires installing the build (`wh make install`) and restarting WebHare. Ask the
user before you do that.

# Debug build
Enable debug builds with environment variable `WHBUILD_DEBUG=1`. Can also be used
to select debug builds for `wh execbuilt` and `wh usebuiltwasm`.
