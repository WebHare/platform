import { config } from '@mod-system/js/internal/configuration';

export function getDefaultRPCBase() {
  return config.backendURL;
}

export function getDtapStage() {
  return config.dtapstage;
}
