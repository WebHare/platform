import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import type { ClusterSecretType, RetiredSecret } from "./config";
import { getScopedResource } from "./codecontexts";
import { logNotice } from "./logwriter";

/* Retired secrets are secrets that have been replaced (eg by `wh auth rotate-secrets`) but may still be in use by
   tokens issued before the rotation. A retired secret is only accepted if the caller allows it (acceptRetired) and it
   hasn't been disabled yet. Otherwise it's only checked to log that it's still being used. Every use is reported to
   the notice log, which `wh auth list-secrets` reads to show which secrets are still used.

   The HareScript implementation is in mod::system/lib/internal/cluster/secrets.whlib. Keep the notice fields in sync
   (they're all lowercase as HareScript can't write camelcase cells) */

/** Log each retired secret + scope combination that is accepted at most once per this interval per process */
const acceptedLogInterval = 10 * 60 * 1000;
/** Log at most this many rejected tokens per minute per process */
const maxRejectedPerMinute = 100;

const lastAcceptedLog = new Map<string, number>();
let rejectWindowStart = 0, rejectsInWindow = 0, rejectsSuppressed = 0;

function getRequestInfoForLog() {
  //The auth audit context knows the client IP if we're handling a request. TS doesn't have a generic way to get the request URL here
  const clientIp = getScopedResource<{ clientIp?: string }>("platform:authcontext")?.clientIp;
  return clientIp ? { ip: clientIp } : {};
}

function reportRetiredSecretUse(retired: RetiredSecret, scope: string, accepted: boolean) {
  const data = {
    event: accepted ? "platform:retired-secret-accepted" : "platform:retired-secret-rejected",
    secretid: retired.id,
    secrettype: retired.type,
    scope,
    compromised: retired.compromised,
    ...(accepted ? {} : { reason: retired.disabledSince ? "disabled" : "scope" }),
    engine: "typescript",
    ...getRequestInfoForLog()
  };

  const now = Date.now();
  if (accepted) {
    const key = retired.id + "\t" + scope;
    const last = lastAcceptedLog.get(key);
    if (last !== undefined && now - last < acceptedLogInterval)
      return;

    lastAcceptedLog.set(key, now);
    logNotice("info", `Accepted a ${scope} token using retired ${retired.type} secret ${retired.id}`, { data });
    return;
  }

  if (now - rejectWindowStart >= 60_000) {
    if (rejectsSuppressed > 0)
      logNotice("warning", `Suppressed ${rejectsSuppressed} more notices about tokens matching retired secrets`, { data: { event: "platform:retired-secret-suppressed", count: rejectsSuppressed } });
    rejectWindowStart = now;
    rejectsInWindow = 0;
    rejectsSuppressed = 0;
  }
  if (rejectsInWindow >= maxRejectedPerMinute) {
    ++rejectsSuppressed;
    return;
  }

  ++rejectsInWindow;
  const message = retired.disabledSince
    ? `Rejected a ${scope} token matching disabled retired ${retired.type} secret ${retired.id}`
    : `Rejected a ${scope} token matching retired ${retired.type} secret ${retired.id}, this scope does not accept retired secrets`;
  logNotice(retired.compromised ? "error" : "warning", message, { data });
}

/** Try the retired secrets of a type after the current secret failed
    @param type - Type of secret to try
    @param scope - Scope of the token, for logging
    @param acceptRetired - Whether the caller accepts tokens created with a retired secret that hasn't been disabled yet
    @param attempt - Callback that tries a secret, returning null (or throwing) if it doesn't match
    @returns The result of the attempt with the matching secret, or null if no secret matched or the match wasn't accepted
*/
export function tryRetiredSecrets<T>(type: ClusterSecretType, scope: string, acceptRetired: boolean, attempt: (secret: string) => T | null): T | null {
  for (const retired of getFullConfigFile().secrets.retired ?? []) {
    if (retired.type !== type)
      continue;

    let result: T | null = null;
    try {
      result = attempt(retired.secret);
    } catch {
      //not this secret
    }
    if (result === null)
      continue;

    const accepted = acceptRetired && !retired.disabledSince;
    reportRetiredSecretUse(retired, scope, accepted);
    return accepted ? result : null;
  }
  return null;
}
