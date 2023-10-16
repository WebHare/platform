import * as fs from "node:fs";
import { registerUpdateConfigCallback, updateWebHareConfigWithoutDB } from "./generation/gen_config";
import { freezeRecursive } from "./util/algorithms";
import { WebHareBackendConfiguration, ConfigFile, WebHareConfigFile } from "@webhare/services/src/config";
import { RecursiveReadOnly } from "@webhare/js-api-tools";

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
