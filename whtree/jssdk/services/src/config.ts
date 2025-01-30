//Types as stored in the backend configuratio
import type { DTAPStage } from "@webhare/env/src/concepts";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
export { backendConfig } from "@mod-system/js/internal/configuration";

export interface ModuleData {
  /** Module's version */
  //version: string;
  /** Absolute path to module root data */
  root: string;
}

export type ModuleMap = { [name: string]: ModuleData };

export type BackendConfiguration = {
  buildinfo: {
    comitttag: string;
    version: string;
    branch: string;
    origin: string;
  };
  /** The data path, ending with a slash. Usually /opt/whdata/. */
  dataroot: string;
  dtapstage: DTAPStage;
  /** The installation (source) path, ending with a slash. Usually /opt/wh/whtree/. */
  installationroot: string;
  module: ModuleMap;
  /** The URL to the backend interface (if configured), eg https://my.webhare.dev/ */
  backendURL: string;
  servername: string;
};

export type ConfigFile = {
  baseport: number;
  modulescandirs: string[];
  public: BackendConfiguration;
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
};

export type WebHareBackendConfiguration = RecursiveReadonly<BackendConfiguration>;
export type WebHareConfigFile = RecursiveReadonly<ConfigFile>;
