import { frontendConfig } from "./frontend-config";

export function getDefaultRPCBase() {
  return location.origin + "/";
}

export function getDtapStage() {
  return frontendConfig.dtapstage;
}
