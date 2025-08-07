import { getAuthorizationInterface } from "@webhare/auth";
import type { AuthorizationInterface } from "@webhare/auth/src/userrights";

export async function invokeOnAuthorizationInterface(entityId: number, method: string, ...args: unknown[]): Promise<unknown> {
  const iface = getAuthorizationInterface(entityId) as unknown as { [key: string]: (...args: unknown[]) => Promise<unknown> };
  if (typeof iface[method] !== 'function')
    throw new Error(`Method '${method}' is not a function on the AuthorizationInterface for entity ID ${entityId}`);

  return await (iface[method as keyof AuthorizationInterface])(...args);
}
