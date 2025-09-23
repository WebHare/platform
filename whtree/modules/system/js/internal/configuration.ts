import * as fs from "node:fs";
import { updateWebHareConfigWithoutDB } from "./generation/gen_config_nodb";
import { freezeRecursive } from "./util/algorithms";
import { type WebHareBackendConfiguration, type ConfigFile, type WebHareConfigFile, getBasePort } from "@webhare/services/src/config";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
import type { AssetPack, Services } from "./generation/gen_extracts";
import { toFSPath } from "@webhare/services/src/resources";
import type { CachedSiteProfiles, SiteProfileRef } from "@webhare/whfs/src/siteprofiles";
import { getScriptName } from "@webhare/system-tools/src/node";
import { updateDebugConfig } from "@webhare/env/src/envbackend";
import { throwError } from "@webhare/std";
import * as semver from "semver";
import type { TasksExtract } from "./generation/gen_extract_tasks";
import type { WRDSchemasExtract } from "./generation/gen_wrd";
import type { WebDesignsExtract } from "./generation/webdesigns";
import type { HooksExtract } from "./generation/gen_extract_hooks";
import type { UserRights } from "./generation/gen_extract_userrights";
import type { ModulePlugins } from "./generation/gen_plugins";

export type { WebHareBackendConfiguration, WebHareConfigFile };

function readConfigFile() {
  let dataroot = process.env.WEBHARE_DATAROOT;
  if (!dataroot)
    throw new Error("Invalid WEBHARE_DATAROOT");
  if (!dataroot.endsWith("/"))
    dataroot += "/";

  const file = `${dataroot}config/platform.json`;
  try {
    return freezeRecursive(JSON.parse(fs.readFileSync(file).toString()) as ConfigFile);
  } catch (e) {
    if (process.env.WEBHARE_NO_CONFIG)
      return freezeRecursive(updateWebHareConfigWithoutDB({}));

    console.error(`Missing configuration json ${JSON.stringify(file)} when running ${getScriptName()}`);
    console.error(`Set WEBHARE_NO_CONFIG=1 if you really need to run without a valid configuration`);
    process.exit(1);
  }
}

let configfile = readConfigFile();
const publicconfig = { ...configfile.public };

export const backendConfig = new Proxy(publicconfig, {
  set() {
    throw new Error(`The WebHare configuration is read-only`);
  }
}) as WebHareBackendConfiguration;

/** Reload the config.json file into backendConfig. Also reloads debug settings */
export function reloadBackendConfig() {
  configfile = readConfigFile();
  Object.assign(publicconfig, configfile.public);
  updateDebugConfig(configfile.debugsettings || null);
}

export function getFullConfigFile(): RecursiveReadonly<ConfigFile> {
  return configfile;
}

export function getRescueOrigin() {
  const rescueip = process.env["WEBHARE_RESCUEPORT_BINDIP"] || "127.0.0.1";
  const rescueport = getBasePort();
  return `http://${rescueip}:${rescueport}`;
}

export function getCompileServerOrigin() {
  return `http://127.0.0.1:${getBasePort() + 1}`;
}

export function getVersionInteger(): number {
  const versioninfo = backendConfig.whVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (versioninfo) {
    const major = parseInt(versioninfo[1]);
    const minor = parseInt(versioninfo[2]);
    const patch = parseInt(versioninfo[3]);
    if (major >= 5 && minor < 100 && patch < 100)
      return major * 10000 + minor * 100 + patch;
  }
  throw new Error(`Version '${backendConfig.whVersion}' is not convertible to a legacy version integer`);
}

export function getVersionFile() {
  return (backendConfig.dataRoot ?? throwError("dataroot not set")) + "webhare.version";
}

export function isRestoredWebHare(): boolean {
  return Boolean(process.env["WEBHARE_ISRESTORED"]);
}

const extractsCache = new Map<string, {
  lastUpdate: number;
  data: unknown;
}>();

function deepFreeze(object: Record<string | symbol, unknown>) {
  for (const name of Reflect.ownKeys(object)) {
    const value = object[name];
    if (value && typeof value === "object")
      deepFreeze(value as Record<string | symbol, unknown>);
  }
  return Object.freeze(object);
}

function getCacheableJSONConfig(diskpath: string) {
  const file = fs.openSync(diskpath, 'r');
  try {
    const stats = fs.fstatSync(file);
    const entry = extractsCache.get(diskpath);
    if (entry?.lastUpdate === stats.mtimeMs)
      return entry.data;

    const buffer = Buffer.alloc(stats.size);
    fs.readSync(file, buffer, 0, stats.size, 0);
    const data = deepFreeze(JSON.parse(buffer.toString('utf8')));

    extractsCache.set(diskpath, { lastUpdate: stats.mtimeMs, data });
    return data;
  } finally {
    fs.closeSync(file);
  }
}

export function isInvalidWebHareUpgrade(from: string, to: string): string | null {
  //Note that we currently assume 'to' is at least WH 5+, especially for the purppose of 4.35 checking
  if (!semver.satisfies(from, ">= 4.35.0", { includePrerelease: true }))
    return `Previous WebHare version '${from}' is older than 5.0.0 - you cannot skip 4.35.xx between 4.34 and 5.0!`;
  if (from.match(/^4\.35\.[0-9]+-.*$/))
    return `Previous WebHare version '${from}' is a dangerous prerelease - you cannot skip 4.35.xx between 4.34 and 5.0!`;

  // if (semver.satisfies(from, "< 4.35.0") && !semver.satisfies(to, ">= 4.35.0 , < 4.35.99"))
  //   return `Previous WebHare version '${from}' is older than 5.0.0 - you cannot skip 4.35.xx between 4.34 and 5.0!`;
  // if (semver.satisfies(from, "< 4.35.0") && !semver.satisfies(to, ">= 4.35.0 , < 4.35.99"))
  // return `Previous WebHare version '${from}' is older than 5.0.0 - you cannot skip 4.35.xx between 4.34 and 5.0!`;
  if (semver.gt(from, to))
    return `You shouldn't downgrade WebHare (previous versions: ${from}, installed version: ${to}`;

  return null;
}

export function getExtractedConfig(which: "assetpacks"): AssetPack[];
export function getExtractedConfig(which: "services"): Services;
export function getExtractedConfig(which: "tasks"): TasksExtract;
export function getExtractedConfig(which: "wrdschemas"): WRDSchemasExtract;
export function getExtractedConfig(which: "webdesigns"): WebDesignsExtract;
export function getExtractedConfig(which: "hooks"): HooksExtract;
export function getExtractedConfig(which: "userrights"): UserRights;
export function getExtractedConfig(which: "plugins"): ModulePlugins;

/** Get JS managed configuration extracts */
export function getExtractedConfig(which: string) {
  return getCacheableJSONConfig(`${backendConfig.dataRoot}config/extracts/${which}.json`);
}

export function getExtractedHSConfig(which: "siteprofiles"): CachedSiteProfiles;
export function getExtractedHSConfig(which: "siteprofilerefs"): SiteProfileRef[];

/** Get HS managed configuration extracts */
export function getExtractedHSConfig(which: string) {
  return getCacheableJSONConfig(toFSPath("storage::system/config/" + which + ".json"));
}
