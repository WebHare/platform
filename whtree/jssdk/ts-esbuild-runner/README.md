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

