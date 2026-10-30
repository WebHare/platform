---
name: jssdk
description: "Use when working on WebHare SDK packages under whtree/jssdk, @webhare package imports, public entrypoints, package layout, README documentation, or npm publication."
---

# WebHare JavaScript SDK packages

## Package names and layout

- SDK packages live in `whtree/jssdk/<package>/`. They are offered to WebHare and its external modules as `@webhare/<package>`: for example, `whtree/jssdk/std/` is `@webhare/std`.
- A TypeScript package's main entrypoint is normally `src/<package>.ts`. For example, `@webhare/std` uses `whtree/jssdk/std/src/std.ts`, and `@webhare/litty` uses `whtree/jssdk/litty/src/litty.ts`.
- `package.json` declares the package name, main entrypoint, dependencies, and TypeDoc entrypoint. Read it before changing the package. Some tooling packages have a different layout: `@webhare/eslint-config`, for example, uses `eslint.config.mjs`.
- The main entrypoint defines or re-exports the public API; implementation files also live under `src/`. Export APIs intended for consumers through the entrypoint.
- Consumers should import from `@webhare/<package>`. Only use subpaths explicitly documented as public, including supported styling or feature entrypoints. Other subpaths, especially `/src/...`, are internal and unstable.
- Follow neighboring packages' metadata conventions, including empty versions for embedded `@webhare/*` dependencies. Don't substitute npm version ranges without checking the SDK packaging process.

## Embedded packages and npm publication

All SDK packages are available within WebHare, but only selected packages are published to npm for use outside WebHare.

- The publication allowlist is `publishPackages` in `whtree/modules/platform/data/facts/axioms.yml`. Check it rather than assuming a package is published.
- Embedded package manifests deliberately use `private: true`, including packages selected for publication. This prevents accidental manual publication; it does not mean the package is unavailable on npm.
- `whtree/modules/platform/scripts/jspackages/validate_jssdk.ts` checks SDK conventions.
- `whtree/modules/platform/scripts/jspackages/publish_jssdk.ts` stages the selected packages and adjusts their metadata for publication. Don't publish directly from the embedded source directory or change `private` to bypass this process.
- For packaging workflow details, consult `doc/npm-modules.md`. Public import conventions are described in `doc/jssdk.md`.

## README documentation

Keep each package's `README.md` self-contained: it may be published as part of an npm module without the rest of the repository.

- Include necessary explanations and complete examples inline, using public `@webhare/<package>` imports.
- Do not rely on repository-relative links to source files, tests, or other packages. Use only absolute URLs when links are necessary.
- Document public behavior and directly related API changes. Publication validation requires a README and package description for published packages.

## Working on a package

1. Read its manifest, main entrypoint, and README, and check nearby implementations before adding new logic.
2. Keep public exports, types, documentation, and consumers consistent.
3. Check publication status before making assumptions about dependencies or runtime availability outside WebHare.
4. Validate changed TypeScript files and run focused existing tests using the repository's TypeScript and test workflows.
