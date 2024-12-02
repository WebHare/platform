import { openBackendService } from '@webhare/services';

/** @deprecated Just use openBackendService("plaform:servicemanager") - it's almost just as internal/unstable as invoking this intenral API */
export async function connectSM() {
  const smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000 });
  return smservice;
}
