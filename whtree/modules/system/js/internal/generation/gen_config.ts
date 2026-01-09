/** this function should use as little dependencies as possible, and no \@mod-... imports in the import tree
 */

import { whconstant_whfsid_webharebackend } from "../webhareconstants";
import { decodeHSON } from "@webhare/hscompat/src/hson";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import { readFile } from "node:fs/promises";
import type { ConfigFile } from "@webhare/services/src/config";

import { appendSlashWhenMissing, isValidDTAPStage, updateWebHareConfigWithoutDB, type PartialConfigFile } from "./gen_config_nodb";
import { reloadBackendConfig } from "../configuration";
import { __createRawConnection } from "@webhare/whdb/src/impl";
import type { WHDBClientInterface } from "@webhare/whdb/src/connectionbase";

async function rawReadRegistryKey<T>(pgclient: WHDBClientInterface, key: string): Promise<T | undefined> {
  const res = await pgclient.query<{ data: string }>("SELECT data FROM system.flatregistry WHERE name = $1", [key]);
  if (!res.rows?.[0])
    return undefined;
  const hsondata = res.rows?.[0].data;
  // Only parse string data
  if (!hsondata.startsWith(`hson:"`))
    return undefined;
  return decodeHSON(hsondata) as (T | undefined);
}

async function updateWebHareConfig(oldconfig: PartialConfigFile, withdb: boolean, { debugSettings }: { debugSettings?: ConfigFile["debugsettings"] | null } = {}): Promise<ConfigFile> {
  const finalconfig: ConfigFile = updateWebHareConfigWithoutDB(oldconfig);

  if (debugSettings)
    finalconfig.debugsettings = debugSettings;
  else if (debugSettings === null)
    delete finalconfig.debugsettings;

  if (!withdb)
    return finalconfig;

  try {
    const pgclient = await __createRawConnection();
    try {
      if (!process.env.WEBHARE_DTAPSTAGE || !isValidDTAPStage(process.env.WEBHARE_DTAPSTAGE)) {
        const dtapstage = await rawReadRegistryKey<string>(pgclient, "system.global.servertype");
        if (!dtapstage)
          return finalconfig;

        finalconfig.public.dtapstage = isValidDTAPStage(dtapstage) ? dtapstage : "production";
      }

      const servername = await rawReadRegistryKey<string>(pgclient, "system.global.servername");
      if (typeof servername === "string") {
        finalconfig.public.serverName = servername;
        finalconfig.public.servername = servername;
      }

      const webrootres = await pgclient.query<{ webroot: string }>("SELECT webhare_proc_sites_webroot(outputweb, outputfolder) AS webroot FROM system.sites WHERE id = $1", [whconstant_whfsid_webharebackend]);
      if (typeof webrootres.rows?.[0]?.webroot === "string")
        finalconfig.public.backendURL = webrootres.rows?.[0].webroot;

      //TODO can we declare the other 3 legacy now we're switching to GCM?
      finalconfig.secrets.cookie = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.cookiesecret") ?? finalconfig.secrets.cookie ?? "";
      finalconfig.secrets.cache = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.cachesecret") ?? finalconfig.secrets.cache ?? "";
      finalconfig.secrets.debug = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.debugsecret") ?? finalconfig.secrets.debug ?? "";
      finalconfig.secrets.gcm = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.gcmsecret") ?? finalconfig.secrets.gcm ?? "";
      finalconfig.defaultImageFormat = (await rawReadRegistryKey<ConfigFile["defaultImageFormat"]>(pgclient, "platform.cache.defaultimageformat") ?? finalconfig.defaultImageFormat) || "keep";

      return finalconfig;
    } finally {
      await pgclient.close();
    }
  } catch (e) {
    console.log(`Error reading configuration from the database`, e);
  }
  return finalconfig;
}

export async function updateWebHareConfigFile({ verbose = false, nodb = false, debugSettings }: { verbose?: boolean; nodb?: boolean; debugSettings?: ConfigFile["debugsettings"] | null } = {}) {
  if (verbose)
    console.time("Updating WebHare config files");

  const dataroot = appendSlashWhenMissing(process.env.WEBHARE_DATAROOT ?? "");
  if (!dataroot)
    throw new Error("Invalid WEBHARE_DATAROOT");

  const dir = dataroot + "config/";
  const file = dir + "platform.json";

  let oldconfig: Partial<ConfigFile> = {}, currenttext: string | null = null;
  try {
    currenttext = await readFile(file, 'utf8');
  } catch (ignore) {
  }

  if (currenttext !== null) {
    try {
      oldconfig = JSON.parse(currenttext);
    } catch (e) {
      console.error("Failed to load old configuration file", e);
      //and ignore it, we don't want to get stuck updating config files
    }
  }

  // process.stderr.write((new Date).toString() + " Starting config update\n");
  const newconfig = await updateWebHareConfig(oldconfig, !nodb, { debugSettings });
  const newconfigtext = JSON.stringify(newconfig, null, 2);
  const anychanges = newconfigtext !== currenttext;

  if (anychanges) {
    await storeDiskFile(file, newconfigtext, { overwrite: true, mkdir: true });
    reloadBackendConfig();

    if (!nodb) {
      // Enumerate all modules that have were added, removed or had their root changed. Need the oldconfig for that
      let changedModules: string[] = [];
      if (typeof oldconfig === "object" && typeof oldconfig.public === "object" && typeof oldconfig.public.module === "object") {
        changedModules = [...new Set([...Object.keys(oldconfig.public.module), ...Object.keys(newconfig.public.module)])].filter(key => {
          const oldModule = oldconfig!.public!.module[key];
          const newModule = newconfig.public.module[key];
          if (!oldModule || !newModule || typeof oldModule !== "object")
            return true;
          return oldModule.root !== newModule.root;
        });
      }

      //    (await import("@webhare/services")).broadcast("system:configupdate"); //TODO resolveplugin doesn't intercept moduleloader yet so can't await
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- we can't await import yet, see above
      const backendEvents = require("@webhare/services/src/backendevents");

      backendEvents.broadcast("system:configupdate");
      for (const module of changedModules)
        backendEvents.broadcast(`system:moduleupdate.${module}`);
    }
  }

  // process.stderr.write((new Date).toString() + " Done config update, modules: " + Object.keys(newconfig.public.module).join(", ") + "\n");
  if (verbose)
    console.timeEnd("Updating WebHare config files");
}
