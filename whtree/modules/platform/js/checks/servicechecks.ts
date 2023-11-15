import { CheckResult } from "@webhare/services";
import { connectSM } from "../bootstrap/servicemanager/smclient";

export async function checkMissingServices(): Promise<CheckResult[]> {
  const smservice = await connectSM();
  const state = await smservice.getWebHareState();
  const missing = state.availableServices.filter(service => !service.isRunning && service.run === "always");

  return missing.map(service => ({
    "type": "platform:missing_service",
    "metadata": { "service": service.name },
    "messageText": `Service ${service.name} is not running`,
    "jumpTo": null,
    "scopes": []
  }));
}
