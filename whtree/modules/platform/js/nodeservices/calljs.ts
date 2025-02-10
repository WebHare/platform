/* The invoke service implements CallJS if invoked from native HareScript */

import { BackendServiceConnection, loadJSFunction } from "@webhare/services";
import { CodeContext } from "@webhare/services/src/codecontexts";

class CallJSService extends BackendServiceConnection {
  async invoke(lib: string, name: string, args: unknown[]) {
    await using context = new CodeContext("CallJSService", { lib, name });
    const func = await loadJSFunction<(...args: unknown[]) => unknown>(`${lib}#${name}`);
    return await context.run(() => func(...args));
  }
}

export async function getCallJSService(servicename: string) {
  return new CallJSService;
}
