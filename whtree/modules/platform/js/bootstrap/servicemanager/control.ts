import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { openBackendService } from "@webhare/services";

export async function restartService(serviceName: string) {
  const backendservice = getExtractedConfig("services").backendServices.find((s) => s.name === serviceName);
  if (backendservice) {
    const servicename = `platform:services.${backendservice.serviceClass}` as const;
    const nodeservices = await openBackendService(servicename);
    await nodeservices.restart(serviceName);
    return;
  }

  using smservice = await openBackendService("platform:servicemanager");
  const result = await smservice.restartService(serviceName);
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }
}

export async function getWebHareServiceState() {
  using smservice = await openBackendService("platform:servicemanager");
  return await smservice.getWebHareState();
}
