import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_webservertype_interface } from "@mod-system/js/internal/webhareconstants";
import { db } from "@webhare/whdb";

/** List webservers */
export async function listWebServers() {
  return (await db<PlatformDB>().selectFrom("system.webservers").select(["baseurl", "type"]).execute()).
    map((row) => ({
      baseURL: row.baseurl,
      isInterface: row.type === whconstant_webservertype_interface,
    }));
}

/** List webservers base URLs hosting the WebHare interface */
export async function listWebHareBackendURLs() {
  //TODO this misses non-redirect aliases for interface webservers
  return (await listWebServers()).filter(s => s.isInterface).map(s => s.baseURL);
}
