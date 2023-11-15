import { ServiceManagerClient } from '@mod-platform/js/bootstrap/servicemanager/main';
import { openBackendService } from '@webhare/services';

const servicename = "platform:servicemanager";

export async function connectSM() {
  const smservice = await openBackendService<ServiceManagerClient>(servicename, [], { timeout: 5000 });
  return smservice;
}
