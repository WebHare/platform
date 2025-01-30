import { type CheckResult, openBackendService } from "@webhare/services";

export async function checkMissingServices(): Promise<CheckResult[]> {
  const smservice = await openBackendService("platform:servicemanager");
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
