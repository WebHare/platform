/* The invoke service implements CallJS if invoked from native HareScript */

import { toAuthAuditContext, type HarescriptJSCallContext } from "@webhare/hscompat/context";
import { BackendServiceConnection, importJSFunction } from "@webhare/services";
import { CodeContext } from "@webhare/services/src/codecontexts";


class CallJSService extends BackendServiceConnection {
  async invoke(lib: string, name: string, args: unknown[], hscontext: HarescriptJSCallContext) {
    await using context = new CodeContext("CallJSService", { lib, name });
    if (hscontext.auth)
      context.setScopedResource("platform:authcontext", toAuthAuditContext(hscontext.auth));

    const func = await importJSFunction<(...args: unknown[]) => unknown>(`${lib}#${name}`);
    return await context.run(() => func(...args));
  }
}

export async function getCallJSService(servicename: string) {
  return new CallJSService;
}
