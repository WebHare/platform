import { WebHareBackendConfiguration } from "./bridgeservice";

let config: WebHareBackendConfiguration | null = null;

export function getConfig(): Readonly<WebHareBackendConfiguration> {
  if (!config)
    throw new Error("WebHare services are not yet available. You may need to await services.ready()");

  return config;
}

export function setConfig(newconfig: Readonly<WebHareBackendConfiguration>) {
  config = newconfig;
}
