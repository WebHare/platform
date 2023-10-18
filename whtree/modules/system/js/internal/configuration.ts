import * as fs from "node:fs";
import { registerUpdateConfigCallback, updateWebHareConfigWithoutDB } from "./generation/gen_config";
import { freezeRecursive } from "./util/algorithms";
import { WebHareBackendConfiguration, ConfigFile, WebHareConfigFile } from "@webhare/services/src/config";
import { RecursiveReadOnly } from "@webhare/js-api-tools";
import { AssetPack } from "./generation/gen_extracts";
import { toFSPath } from "@webhare/services/src/resources";

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
      console.error(`Missing configuration json when running ${require.main?.filename}`);
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

export function updateConfig() {
  configfile = readConfigFile();
  Object.assign(publicconfig, configfile.public);
}

export function getFullConfigFile(): RecursiveReadOnly<ConfigFile> {
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

export function getExtractedConfig(which: "assetpacks"): AssetPack[] {
  return JSON.parse(fs.readFileSync(toFSPath("storage::system/generated/extract/" + which + ".json"), 'utf8'));
}
