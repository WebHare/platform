//Types as stored in the backend configuratio
import type { DTAPStage } from "@webhare/env/src/concepts";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
export { backendConfig } from "@mod-system/js/internal/configuration";
export { getBasePort } from "./environment";

export interface ModuleData {
  /** Module's version */
  version?: string;
  /** Absolute path to module root data */
  root: string;
}

export type ModuleMap = { [name: string]: ModuleData };

export type BackendConfiguration = {
  /** The data path, ending with a slash. Usually /opt/whdata/. */
  dataRoot: string;
  dtapstage: DTAPStage;
  /** The installation (source) path, ending with a slash. Usually /opt/wh/whtree/. */
  installationRoot: string;
  module: ModuleMap;
  /** The URL to the backend interface (if configured), eg https://my.webhare.dev/ */
  backendURL: string;
  serverName: string;
  /** WebHare version number (the semantic-version of the current WebHare (eg 5.7.1) */
  whVersion: string;

  /** @deprecated Switch the camel-cased version `dataRoot` in WH 5.7+ */
  dataroot: string;
  /** @deprecated Switch the camel-cased version `installationRoot` in WH 5.7+ */
  installationroot: string;
  /** @deprecated Switch the camel-cased version `serverName` in WH 5.7+ */
  servername: string;
};

export type ConfigFile = {
  modulescandirs: string[];
  public: BackendConfiguration;
  defaultImageFormat: "keep" | "image/webp" | "image/avif";
  secrets: {
    cache: string;
    cookie: string;
    debug: string;
    gcm: string;
  };
  debugsettings?: {
    tags: string[];
    context: string;
    outputsession: string;
  };
  socketDir?: string;
};

export type WebHareBackendConfiguration = RecursiveReadonly<BackendConfiguration>;
export type WebHareConfigFile = RecursiveReadonly<ConfigFile>;
