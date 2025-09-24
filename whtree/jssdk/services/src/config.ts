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
  /** @deprecated buildinfo will be removed. use whVersion to get the semantic-version of the current WebHare (eg 5.7.1) */
  buildinfo: {
    committag: string;
    version: string;
    branch: string;
    origin: string;
    builddatetime: string;
  };
  /** The data path, ending with a slash. Usually /opt/whdata/. */
  dataRoot: string;
  dtapstage: DTAPStage;
  /** The installation (source) path, ending with a slash. Usually /opt/wh/whtree/. */
  installationRoot: string;
  module: ModuleMap;
  /** The URL to the backend interface (if configured), eg https://my.webhare.dev/ */
  backendURL: string;
  serverName: string;
  /** WebHare version number */
  whVersion: string;

  /** @deprecated Switch the camel-cased version `dataRoot` in WH 5.7+ */
  dataroot: string;
  /** @deprecated Switch the camel-cased version `installationRoot` in WH 5.7+ */
  installationroot: string;
  /** @deprecated Switch the camel-cased version `installationRoot` in WH 5.7+ */
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
};

export type WebHareBackendConfiguration = RecursiveReadonly<BackendConfiguration>;
export type WebHareConfigFile = RecursiveReadonly<ConfigFile>;

export function getBasePort() {
  if (!process.env.WEBHARE_BASEPORT)
    throw new Error("WEBHARE_BASEPORT not set in environment");

  const port = parseInt(process.env.WEBHARE_BASEPORT, 10);
  if (port < 1024 || port > 65500)
    throw new Error(`Invalid WEBHARE_BASEPORT '${process.env.WEBHARE_BASEPORT}'`);

  return port;
}
