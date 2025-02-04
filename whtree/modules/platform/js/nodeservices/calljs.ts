/* The invoke service implements CallJS if invoked from native HareScript */

import { BackendServiceConnection, loadJSFunction } from "@webhare/services";

class CallJSService extends BackendServiceConnection {
  async invoke(lib: string, name: string, args: unknown[]) {
    const func = await loadJSFunction<(...args: unknown[]) => unknown>(`${lib}#${name}`);
    return await func(...args);
  }
}

export async function getCallJSService(servicename: string) {
  return new CallJSService;
}
