/** this function should use as little dependencies as possible, and no \@mod-... imports in the import tree
 */

import * as fs from "node:fs";
import { omit, pick, throwError } from "@webhare/std";
import type { RecursivePartial } from "@webhare/js-api-tools";
import type { DTAPStage } from "@webhare/env/src/concepts";
import type { BackendConfiguration, ConfigFile, ModuleData, ModuleMap } from "@webhare/services/src/config";
import { isValidModuleName } from "@webhare/services/src/naming";
import { join } from "node:path";

export function appendSlashWhenMissing(path: string) {
  return !path || path.endsWith("/") ? path : path + "/";
}

export function isValidDTAPStage(dtapstage: string): dtapstage is DTAPStage {
  return ["production", "acceptance", "test", "development"].includes(dtapstage);
}

type NoDBConfig = Pick<ConfigFile, "modulescandirs"> & { public: Pick<BackendConfiguration, "dataRoot" | "installationRoot" | "module" | "dataroot" | "installationroot" | "whVersion"> & Partial<Pick<BackendConfiguration, "dtapstage">> };

type ModuleScanData = ModuleData & { creationdate: Date };
type ModuleScanMap = Map<string, ModuleScanData>;

export function getBuildInfo() {
  const buildinfo = {
    committag: "",
    version: "",
    branch: "",
    origin: "",
    builddatetime: "",
  };

  try {
    const buildinfo_lines = fs.readFileSync(join(process.env.WEBHARE_DIR ?? throwError("WEBHARE_DIR not set"), "modules/platform/generated/buildinfo")).toString().split("\n");
    for (const line of buildinfo_lines) {
      const eqpos = line.indexOf("=");
      if (eqpos !== -1) {
        const key = line.substring(0, eqpos).trim();
        let value = line.substring(eqpos + 1).trim();
        if (key in buildinfo) {
          if (value.startsWith('"'))
            value = JSON.parse(value);
          buildinfo[key as keyof typeof buildinfo] = value;
        }
      }
    }
  } catch (e) {
    // ignore non-existing buildinfo
  }
  return buildinfo;
}

export function generateNoDBConfig(): NoDBConfig {
  const dataRoot = appendSlashWhenMissing(process.env.WEBHARE_DATAROOT ?? "");
  const installationRoot = appendSlashWhenMissing(process.env.WEBHARE_DIR ?? "");

  if (!dataRoot)
    throw new Error("Invalid WEBHARE_DATAROOT");
  if (!installationRoot)
    throw new Error("Cannot determine the WebHare ¯installation root");

  const modulescandirs = [dataRoot + "installedmodules/"];

  const env_modulepaths = process.env.WEBHARE_MODULEPATHS ?? "";
  if (env_modulepaths) {
    for (const path of env_modulepaths.split(":").filter(p => p))
      modulescandirs.push(appendSlashWhenMissing(path));
  }

  const scanmap: ModuleScanMap = new Map;
  for (const moduledir of modulescandirs)
    scanModuleFolder(scanmap, moduledir, true, false);
  scanModuleFolder(scanmap, installationRoot + "modules/", true, true);

  const module: ModuleMap = Object.fromEntries([...scanmap.entries()].map(([name, data]) => [name, { root: data.root }]));
  const retval: NoDBConfig = {
    modulescandirs,
    public: {
      dataRoot: dataRoot,
      installationRoot: installationRoot,
      module,
      whVersion: getBuildInfo().version,

      //legacy/obsolete data:
      dataroot: dataRoot,
      installationroot: installationRoot,
    }
  };

  if (process.env.WEBHARE_DTAPSTAGE && isValidDTAPStage(process.env.WEBHARE_DTAPSTAGE))
    retval.public.dtapstage = process.env.WEBHARE_DTAPSTAGE;

  return retval;
}

export type PartialConfigFile = RecursivePartial<ConfigFile> & { debugsettings?: ConfigFile["debugsettings"] };

export function updateWebHareConfigWithoutDB(oldconfig: PartialConfigFile): ConfigFile {
  const nodbconfig = generateNoDBConfig();

  const publicdata: BackendConfiguration = {
    dtapstage: "production",
    serverName: "",
    servername: "",
    backendURL: "",
    ...oldconfig?.public,
    ...nodbconfig.public,
  };

  return {
    public: publicdata,
    secrets: {  //copy from oldconfig, ensure they were actually a string
      cache: String(oldconfig?.secrets?.cache || ''),
      cookie: String(oldconfig?.secrets?.cookie || ''),
      debug: String(oldconfig?.secrets?.debug || ''),
      gcm: String(oldconfig?.secrets?.gcm || ''),
    },
    defaultImageFormat: oldconfig?.defaultImageFormat || "keep",
    ...pick(oldconfig, ["debugsettings"]),
    ...omit(nodbconfig, ["public"]),
  };
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

/* The devkit module is part of Webhare but not activated inside a container (WEBHARE_IN_CONTAINER) unless WEBHARE_ENABLE_DEVKIT is set */
export function enableDevKit() {
  /* Initially devkit also activated for WEBHARE_CI_MODULE - but that's dangerous as it we wouldn't enable it on prod either. We might have
     future validation steps in CI that *do* use WEBHARE_CI_MODULE but if we want that, it's better to do those in a separate CI step or
     to somehow relaunch webhare with an enabled devkit */
  return Boolean(process.env.WEBHARE_ENABLE_DEVKIT || !process.env.WEBHARE_IN_CONTAINER);
}

function scanModuleFolder(modulemap: ModuleScanMap, folder: string, rootfolder: boolean, always_overwrites: boolean) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (e) {
    // not a directory
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink())
      continue;
    if (entry.name === "devkit" && !enableDevKit())
      continue;

    const modpath = folder + entry.name + "/";
    const hasModXML = fs.statSync(modpath + "moduledefinition.xml", { throwIfNoEntry: false });
    const hasModYML = fs.statSync(modpath + "moduledefinition.yml", { throwIfNoEntry: false });

    if (!hasModXML && !hasModYML) {
      if (rootfolder)
        scanModuleFolder(modulemap, modpath, false, always_overwrites);

      continue;
    }

    const nameinfo = parseModuleFolderName(entry.name);
    if (!nameinfo || !isValidModuleName(nameinfo.name))
      continue;

    const mdata = { creationdate: nameinfo.creationdate, root: modpath };

    const current = modulemap.get(nameinfo.name);
    if (current) {
      if (!always_overwrites && current.creationdate >= nameinfo.creationdate) {
        //console.log(`Older module version found at ${modpath}`);
        continue;
      }
      //console.log(`New module version found at ${modpath}`);
    }
    modulemap.set(nameinfo.name, mdata);
  }
}
