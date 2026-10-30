import { openBackendService } from "@webhare/services";

export async function restartService(serviceName: string) {
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
