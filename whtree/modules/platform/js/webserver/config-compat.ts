import * as test from "@webhare/test";
import { loadlib } from "@webhare/harescript";
import { getHostedSites } from "./config";

export async function compareHSandTSConfig() {
  const hs_sites = await loadlib("mod::system/lib/internal/webserver/confighelpers.whlib").GetHostedSites();
  const ts_sites = (await getHostedSites());
  test.eq(hs_sites, ts_sites);
}
