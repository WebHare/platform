# WebHare environment

`@webhare/env` provides access to basic WebHare configuration and debugflags. It is separated to allow use in code shared between frontend and backend.

You would generally import this package this way:

```javascript
import { debugFlags, isLive, dtapStage } from "@webhare/env";
```

## DebugFlags and fetch hooking
WebHare backend scripts all use a preload hook to make `WEBHARE_DEBUG` and especially the fetch hook for the `wrq` flag work when invoked directly or indirectly by `wh run`

Similarly all WebHare assetpacks include a small loader to activate `wh-debug` cookie/URL variables and the fetch hook in their polyfill (currently `mod::publisher/js/internal/polyfills/all.ts`)

If you use @webhare/env *outside WebHare* these preloads may not be present and you may need to manually add support for environment variables and the fetch hook. Eg:
the following code will parse the SV_DEBUG environment variable for any flags:

```typescript
import { enableFetchDebugging } from '@webhare/env';
import { updateDebugConfig } from '@webhare/env/dist/envbackend'; //NOTE: currently an internal API

updateDebugConfig({ //FIXME internal api.Rob: sja, we zouden ook bij het setten van een debugflag die callbacks kunnen aanroepen  zo vaak gebeurt het niet
  tags: process.env.SV_DEBUG?.split(',') || [],
});
enableFetchDebugging();
```
