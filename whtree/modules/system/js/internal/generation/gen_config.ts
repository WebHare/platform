/** this function should use as little dependencies as possible, and no \@mod-... imports in the import tree
 */

import * as fs from "node:fs";
import { omit, pick } from "@webhare/std";
import { RecursivePartial } from "../util/algorithms";
import { WHDBPgClient } from "@webhare/whdb/src/connection"; //we need a raw client without services/config dependency to bootstrap
import { whconstant_whfsid_webharebackend } from "../webhareconstants";
import { decodeHSON } from "../whmanager/hsmarshalling";
import { DTAPStage } from "@webhare/env/src/concepts";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import { readFile } from "node:fs/promises";
import type { BackendConfiguration, ConfigFile, ModuleMap } from "@webhare/services/src/config";

function appendSlashWhenMissing(path: string) {
  return !path || path.endsWith("/") ? path : path + "/";
}

function isValidDTAPStage(dtapstage: string): dtapstage is DTAPStage {
  return Object.values(DTAPStage).includes(dtapstage as DTAPStage);
}

type NoDBConfig = Pick<ConfigFile, "modulescandirs" | "baseport"> & { public: Pick<BackendConfiguration, "dataroot" | "installationroot" | "module" | "buildinfo"> & Partial<Pick<BackendConfiguration, "dtapstage">> };

export function generateNoDBConfig(): NoDBConfig {
  let baseport = Number(process.env.WEBHARE_BASEPORT || "0");
  const dataroot = appendSlashWhenMissing(process.env.WEBHARE_DATAROOT ?? "");
  const installationroot = appendSlashWhenMissing(process.env.WEBHARE_DIR ?? "");

  if (baseport == 0)
    baseport = 13679; //default port, needed for backwards compatibility
  if (baseport < 1024 || baseport > 65500)
    throw new Error("Invalid WEBHARE_BASEPORT");
  if (!dataroot)
    throw new Error("Invalid WEBHARE_DATAROOT");
  if (!installationroot)
    throw new Error("Cannot determine the WebHare installation root");

  const modulescandirs = [dataroot + "installedmodules/"];

  const env_modulepaths = process.env.WEBHARE_MODULEPATHS ?? "";
  if (env_modulepaths) {
    for (const path of env_modulepaths.split(":").filter(p => p))
      modulescandirs.push(appendSlashWhenMissing(path));
  }

  const buildinfo: BackendConfiguration["buildinfo"] = {
    comitttag: "",
    version: "",
    branch: "",
    origin: ""
  };

  //weird.. we had to wrap the array int spaces to prevent autoformat from stripping the space before satisfies (which VScode then readds...)
  const buildinfo_keys = (["comitttag", "version", "branch", "origin"]) satisfies Array<keyof typeof buildinfo>;

  try {
    const buildinfo_lines = fs.readFileSync(installationroot + "modules/system/whres/buildinfo").toString().split("\n");
    for (const line of buildinfo_lines) {
      const eqpos = line.indexOf("=");
      if (eqpos !== -1) {
        const key = line.substring(0, eqpos).trim() as keyof typeof buildinfo;
        let value = line.substring(eqpos + 1).trim();
        if (buildinfo_keys.includes(key)) {
          if (value.startsWith('"'))
            value = JSON.parse(value);
          buildinfo[key] = value;
        }
      }
    }
  } catch (e) {
    // ignore non-existing buildinfo
  }

  const module: ModuleMap = {};
  for (const moduledir of modulescandirs)
    scanModuleFolder(module, moduledir, true, false);
  scanModuleFolder(module, installationroot + "modules/", true, true);

  const retval: NoDBConfig = {
    baseport,
    modulescandirs,
    public: {
      buildinfo,
      dataroot,
      installationroot,
      module,
    }
  };

  if (process.env.WEBHARE_DTAPSTAGE && isValidDTAPStage(process.env.WEBHARE_DTAPSTAGE))
    retval.public.dtapstage = process.env.WEBHARE_DTAPSTAGE;

  return retval;
}

async function rawReadRegistryKey<T>(pgclient: WHDBPgClient, key: string): Promise<T | undefined> {
  const res = await pgclient.query<{ data: string }>("SELECT data FROM system.flatregistry WHERE name = $1", [key]);
  if (!res.rows?.[0])
    return undefined;
  const hsondata = res.rows?.[0].data;
  // Only parse string data
  if (!hsondata.startsWith(`hson:"`))
    return undefined;
  return decodeHSON(hsondata) as (T | undefined);
}


type PartialConfigFile = RecursivePartial<ConfigFile> & { debugsettings?: ConfigFile["debugsettings"] };

export function updateWebHareConfigWithoutDB(oldconfig: PartialConfigFile): ConfigFile {
  const nodbconfig = generateNoDBConfig();

  const publicdata: BackendConfiguration = {
    dtapstage: DTAPStage.Production,
    servername: "",
    backendURL: "",
    ...oldconfig?.public,
    ...nodbconfig.public,
  };

  return {
    public: publicdata,
    secrets: { cache: "", cookie: "", debug: "" },
    ...pick(oldconfig, ["debugsettings"]),
    ...omit(nodbconfig, ["public"]),
  };
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
    const pgclient = new WHDBPgClient;
    await pgclient.connect();
    try {
      if (!process.env.WEBHARE_DTAPSTAGE || !isValidDTAPStage(process.env.WEBHARE_DTAPSTAGE)) {
        const dtapstage = await rawReadRegistryKey<string>(pgclient, "system.global.servertype");
        if (!dtapstage)
          return finalconfig;

        finalconfig.public.dtapstage = isValidDTAPStage(dtapstage)
          ? dtapstage
          : DTAPStage.Production;
      }

      const servername = await rawReadRegistryKey<string>(pgclient, "system.global.servername");
      if (typeof servername === "string")
        finalconfig.public.servername = servername;

      const webrootres = await pgclient.query<{ webroot: string }>("SELECT webhare_proc_sites_webroot(outputweb, outputfolder) AS webroot FROM system.sites WHERE id = $1", [whconstant_whfsid_webharebackend]);
      if (typeof webrootres.rows?.[0]?.webroot === "string")
        finalconfig.public.backendURL = webrootres.rows?.[0].webroot;

      finalconfig.secrets.cookie = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.cookiesecret") ?? finalconfig.secrets.cookie ?? "";
      finalconfig.secrets.cache = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.cachesecret") ?? finalconfig.secrets.cache ?? "";
      finalconfig.secrets.debug = await rawReadRegistryKey<string>(pgclient, "system.webserver.security.debugsecret") ?? finalconfig.secrets.debug ?? "";

      return finalconfig;
    } finally {
      pgclient.close();
    }
  } catch (e) {
    console.log(`Error reading configuration from the database`, e);
  }
  return finalconfig;
}

export function parseModuleFolderName(name: string) {
  const dotpos = name.indexOf('.');
  if (dotpos !== -1) {
    const dateparts = name.match(/\.(20\d\d)(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(\.\d\d\d)?Z$/);
    if (!dateparts) {
      return null;
    }
    const isofulldate = `${dateparts[1]}-${dateparts[2]}-${dateparts[3]}T${dateparts[4]}:${dateparts[5]}:${dateparts[6]}${dateparts[7] || ''}Z`;
    const isofulldate_msecs = Date.parse(isofulldate);
    if (!isofulldate_msecs) {
      // Invalid ISO date, ignore module
      return null;
    }
    return { creationdate: new Date(isofulldate_msecs), name: name.substring(0, dotpos) };
  }

  return { creationdate: new Date(Date.parse("1970-01-01T00:00:00Z")), name };
}

function scanModuleFolder(modulemap: ModuleMap, folder: string, rootfolder: boolean, always_overwrites: boolean) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (e) {
    // not a directory
    return;
  }

  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name === "deleted")
      continue;

    const modpath = folder + entry.name + "/";
    if (!fs.statSync(modpath + "moduledefinition.xml", { throwIfNoEntry: false })) {
      if (rootfolder)
        scanModuleFolder(modulemap, modpath, false, always_overwrites);
      else {
        // console.log(`skipping folder ${modpath}, it has no moduledefinition`);
      }
      continue;
    }

    const nameinfo = parseModuleFolderName(entry.name);
    if (!nameinfo)
      continue;

    const mdata = { creationdate: nameinfo.creationdate, root: modpath };

    const current = modulemap[nameinfo.name];
    if (current) {
      if (!always_overwrites && current.creationdate >= nameinfo.creationdate) {
        //console.log(`Older module version found at ${modpath}`);
        continue;
      }
      //console.log(`New module version found at ${modpath}`);
    }
    modulemap[nameinfo.name] = mdata;
  }
}

const updateCallbacks = new Array<() => void>;

// Listen to local updateWebHareConfigFile changes. This is *not* a global (bridge event) config change listener.
export function registerUpdateConfigCallback(cb: () => void) {
  updateCallbacks.push(cb);
}

export async function updateWebHareConfigFile({ verbose = false, nodb = false, debugSettings }: { verbose?: boolean; nodb?: boolean; debugSettings?: ConfigFile["debugsettings"] | null } = {}) {
  const dataroot = appendSlashWhenMissing(process.env.WEBHARE_DATAROOT ?? "");
  if (!dataroot)
    throw new Error("Invalid WEBHARE_DATAROOT");

  const dir = dataroot + "storage/system/generated/config/";
  const file = dir + "config.json";

  let oldconfig = {}, currenttext: string | null = null;
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
    await storeDiskFile(file, newconfigtext, { overwrite: true });
    for (const cb of [...updateCallbacks])
      cb();

    if (!nodb) {
      //    (await import("@webhare/services")).broadcast("system:configupdate"); //TODO resolveplugin doesn't intercept moduleloader yet so can't await
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- we can't await import yet, see above
      require("@webhare/services").broadcast("system:configupdate");
    }
  }

  // process.stderr.write((new Date).toString() + " Done config update, modules: " + Object.keys(newconfig.public.module).join(", ") + "\n");
}
