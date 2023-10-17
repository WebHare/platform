import { backendConfig } from '@mod-system/js/internal/configuration';

export function getDefaultRPCBase() {
  return backendConfig.backendURL;
}

export function getDtapStage() {
  return backendConfig.dtapstage;
}
