//This preload is invoked for all node scripts executed by WebHare (together with the TS preload support)

import { addConfigUpdateHandler, backendConfig, getFullConfigFile } from '@mod-system/js/internal/configuration';
import { debugFlags, initEnv, updateDebugConfig } from '@webhare/env/src/envbackend';
import { env } from "node:process";


initEnv(backendConfig.dtapstage, backendConfig.backendURL);
updateDebugConfig(getFullConfigFile().debugsettings || null);

addConfigUpdateHandler(() => updateDebugConfig(getFullConfigFile().debugsettings || null));

// Prefill the debug flags with the contents of the WEBHARE_DEBUG environment variable
for (const flag of env.WEBHARE_DEBUG?.split(',') || [])
  if (flag)
    debugFlags[flag] = true;
