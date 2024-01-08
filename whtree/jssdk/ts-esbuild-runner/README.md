# ts-esbuild-runner
This is the WebHare wrapper around [esbuild](https://github.com/evanw/esbuild) which maintains a cache of compiled files.

## Setup
To get started:

```bash
npm init @webhare/ts-esbuild-runner@latest
echo 'console.log(42 as number);' > test.ts
./node_modules/.bin/tsrun test.ts
```

Note that tsrun doesn't do any TypeScript validation. For that you will still need to set up the TypeScript compiler and your
will need a tsconfig.json in its root, eg:

```json
{
  "extends": "@tsconfig/recommended",
  "compilerOptions": {
    "baseUrl": ".",
    "noEmit": true,
    "target": "es2022",
    "isolatedModules": true
  }
}
```
The option `"isolatedModules": true` improves compatibility with esbuild

Compiled TS files are cached in `$HOME/.ts-esbuild-runner-cache`.

To debug `tsrun` set the environment variable `ESBUILDRUNNER` to `debug`.

## WebHare integration
WebHare does not directly use or supply `tsrun` but builds a slightly [different version](../../modules/platform/js/bootstrap/whnode.ts) of this plugin with the following changes:
- tsrun is integratedd into `wh run`
- You need to set `WEBHARE_DEBUG=runner` instead of `ESBUILDRUNNER=debug` to debug
- Compiled TS files are cached inside the whdata folder in ephemeral/compilecache/typescript (use `wh dirs` and look for `WEBHARE_TSBUILDCACHE` to get the exact folder)
