//This preload is invoked for all node scripts executed by WebHare (together with the TS preload support)

import { backendConfig } from '@mod-system/js/internal/configuration';
import { initEnv } from '@webhare/env/src/envbackend';

initEnv(backendConfig.dtapstage, backendConfig.backendURL);
