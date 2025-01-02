//This preload is invoked for all node scripts executed by WebHare (together with the TS preload support)

import { addConfigUpdateHandler, backendConfig, getFullConfigFile } from '@mod-system/js/internal/configuration';
import { debugFlags, initEnv, updateDebugConfig } from '@webhare/env/src/envbackend';
import { enableFetchDebugging } from '@webhare/env/src/fetchdebug';
import { setGetTidHooksFactory } from '@webhare/gettid/src/hooks';
import { env } from "node:process";


initEnv(backendConfig.dtapstage, backendConfig.backendURL);
updateDebugConfig(getFullConfigFile().debugsettings || null);

addConfigUpdateHandler(() => updateDebugConfig(getFullConfigFile().debugsettings || null));

// Prefill the debug flags with the contents of the WEBHARE_DEBUG environment variable
for (const flag of [...(env.WEBHARE_DEBUG?.split(',') ?? []), ...(env.__WEBHARE_DEBUG_INITIALSETTING?.split(',') ?? [])])
  if (flag)
    debugFlags[flag] = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
setGetTidHooksFactory(() => require("@mod-tollium/js/internal/gettid_nodehooks.ts").getGetTidNodeHooks());

enableFetchDebugging();
