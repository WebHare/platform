# ts-esbuild-runner
This is the WebHare wrapper around esbuild which maintains a cache of compiled files.

## Setup
Your project will need a tsconfig.json in its root, eg

```json
{
  "extends": "@tsconfig/recommended",
  "compilerOptions": {
    "baseUrl": ".",
    "noEmit": true,
    "target": "es2022"
  }
}
```

You can setup the cache's location by setting the `WEBHARE_TSBUILDCACHE` variable.
It will default to `.ts-esbuild-runner-cache` in your home directory.

Set `WEBHARE_DEBUG=runner` to get debug information from the plugin
