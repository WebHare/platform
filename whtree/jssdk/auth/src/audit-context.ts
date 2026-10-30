import { getScopedResource, setScopedResource } from "@webhare/services/src/codecontexts";

export type AuthAuditContext = {
  /** Remote IP address */
  clientIp?: string;
  /** Country. If not set it will be looked up */
  country?: string;
  /** User agent type: platform-browsername-version eg ios-safari-11 */
  browserTriplet?: string;
  /** User performing this action. Depending on the event type this will be the user triggering an action, and may not be the affected account (eg locking another user) */
  actionBy?: number | null;
  /** Login name of the user performing this action. If not set it will be looked up */
  actionByLogin?: string;
  /** User impersonating this account (either the actionBy or the account) */
  impersonatedBy?: number | null;
  /** Login name of the user impersonating this account. If not set it will be looked up */
  impersonatedByLogin?: string;
};

export function getAuditContext() {
  return getScopedResource<AuthAuditContext>("platform:authcontext");
}

export function updateAuditContext(updates: AuthAuditContext) {
  setScopedResource("platform:authcontext", {
    ...getScopedResource<AuthAuditContext>("platform:authcontext"),
    ...updates
  });
}