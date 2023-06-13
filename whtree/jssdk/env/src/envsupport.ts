import { config } from '@mod-system/js/internal/configuration';

export function getDefaultRPCBase() {
  return config.backendurl;
}

export function getDtapStage() {
  return config.dtapstage;
}
