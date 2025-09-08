import type { AuthAuditContext } from "@webhare/auth";

type HarescriptAuditContext = {
  remoteip?: string;
  country?: string;
  browsertriplet?: string;
  user_entityid?: number;
  user_login?: string;
  impersonator_entityid?: number;
  impersonator_login?: string;
};

export type HarescriptJSCallContext = {
  auth: HarescriptAuditContext | null;
};

export function toAuthAuditContext(hscontext: HarescriptAuditContext): AuthAuditContext {
  return {
    clientIp: hscontext.remoteip || undefined,
    browserTriplet: hscontext.browsertriplet || undefined,
    actionBy: hscontext.user_entityid || null,
    actionByLogin: hscontext.user_login || undefined,
    impersonatedBy: hscontext.impersonator_entityid || null,
    impersonatedByLogin: hscontext.impersonator_login || undefined
  };
}
