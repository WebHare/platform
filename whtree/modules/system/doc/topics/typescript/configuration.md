# Configuration

## Implementation notes
- whtree/tsConfig.json
  - `ts-node.compilerOptions` override the compilerOptions for ts-node. This keeps these settings away from esbuild
- We disable `noImplicitAny` and `strictPropertyInitialization` for compatibility with the VSCode configuration and easing
  the transition to TypeScript. We may reenable these checks in the future
