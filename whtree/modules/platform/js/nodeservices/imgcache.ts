import { runUnifiedCacheService } from "../cache/imgcache";

void runUnifiedCacheService({ debug: Boolean(process.env.WEBHARE_DEBUG_SERVICE) });
