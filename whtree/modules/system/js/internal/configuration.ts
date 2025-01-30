import * as fs from "node:fs";
import { registerUpdateConfigCallback, updateWebHareConfigWithoutDB } from "./generation/gen_config_nodb";
import { freezeRecursive } from "./util/algorithms";
import type { WebHareBackendConfiguration, ConfigFile, WebHareConfigFile } from "@webhare/services/src/config";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
import type { AssetPack, Services } from "./generation/gen_extracts";
import { toFSPath } from "@webhare/services/src/resources";
import type { CachedSiteProfiles, SiteProfileRef } from "@webhare/whfs/src/siteprofiles";
import { getScriptName } from "@webhare/system-tools/src/node";

export type { WebHareBackendConfiguration, WebHareConfigFile };

let loggederror = false;

function readConfigFile() {
  let dataroot = process.env.WEBHARE_DATAROOT;
  if (!dataroot)
    throw new Error("Invalid WEBHARE_DATAROOT");
  if (!dataroot.endsWith("/"))
    dataroot += "/";

  const file = `${dataroot}storage/system/generated/config/config.json`;
  try {
    return freezeRecursive(JSON.parse(fs.readFileSync(file).toString()) as ConfigFile);
  } catch (e) {
    if (!loggederror) {
      console.error(`Missing configuration json when running ${getScriptName()}`);
      loggederror = true;
    }
    return freezeRecursive(updateWebHareConfigWithoutDB({}));
  }
}

registerUpdateConfigCallback(() => updateConfig());

let configfile = readConfigFile();
const publicconfig = { ...configfile.public };

export const backendConfig = new Proxy(publicconfig, {
  set() {
    throw new Error(`The WebHare configuration is read-only`);
  }
}) as WebHareBackendConfiguration;

const updateHandlers = new Array<() => void>;

export function updateConfig() {
  configfile = readConfigFile();
  Object.assign(publicconfig, configfile.public);
  for (const handler of [...updateHandlers]) {
    // ignore throws here, we can't do anything in this lowlevel code
    try { handler(); } catch (e) { }
  }
}

export function addConfigUpdateHandler(handler: () => void): void {
  updateHandlers.push(handler);
}

export function getFullConfigFile(): RecursiveReadonly<ConfigFile> {
  return configfile;
}

export function getRescueOrigin() {
  const rescueip = process.env["WEBHARE_RESCUEPORT_BINDIP"] || "127.0.0.1";
  const rescueport = process.env["WEBHARE_BASEPORT"] || "13679";
  return `http://${rescueip}:${rescueport}`;
}

export function getCompileServerOrigin() {
  return `http://127.0.0.1:${getFullConfigFile().baseport + 1}`;
}

export function getVersionInteger(): number {
  const versioninfo = backendConfig.buildinfo.version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (versioninfo) {
    const major = parseInt(versioninfo[1]);
    const minor = parseInt(versioninfo[2]);
    const patch = parseInt(versioninfo[3]);
    if (major >= 5 && minor < 100 && patch < 100)
      return major * 10000 + minor * 100 + patch;
  }
  throw new Error(`Version '${backendConfig.buildinfo.version}' is not convertible to a legacy version integer`);
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

export function getExtractedConfig(which: "assetpacks"): AssetPack[];
export function getExtractedConfig(which: "services"): Services;

/** Get JS managed configuration extracts */
export function getExtractedConfig(which: string) {
  return getCacheableJSONConfig(toFSPath("storage::system/generated/extract/" + which + ".json"));
}

export function getExtractedHSConfig(which: "siteprofiles"): CachedSiteProfiles;
export function getExtractedHSConfig(which: "siteprofilerefs"): SiteProfileRef[];

/** Get HS managed configuration extracts */
export function getExtractedHSConfig(which: string) {
  return getCacheableJSONConfig(toFSPath("storage::system/config/" + which + ".json"));
}
