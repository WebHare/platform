import { config } from "./frontend-config";

export function getDefaultRPCBase() {
  return location.origin + "/";
}

export function getDtapStage() {
  return config.dtapstage;
}
