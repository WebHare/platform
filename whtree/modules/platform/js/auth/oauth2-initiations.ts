import jwt from "jsonwebtoken";
import { getServerSession, updateServerSession, type SessionScopes } from "@webhare/services";
import { db } from "@webhare/whdb";
import { readAnyFromDatabase } from "@webhare/whdb/src/formats";
import { wrd, type AnyWRDSchema } from "@webhare/wrd";
import { getAuthSettings } from "@webhare/auth/src/settings";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

export type OAuth2InitiationStatus = "pending" | "completed" | "failed";

export interface OAuth2Initiation {
  created: Date;
  sessionId: string;
  /** pending: the user hasn't returned from the authorization server (yet) */
  status: OAuth2InitiationStatus;
  error: { error: string; error_description: string | null } | null;
  /** Client scope the result is bound to (eg platform:connect-peer) */
  clientScope: string;
  /** Authorization endpoint the user was sent to */
  authorizeURL: string;
  /** Scopes requested from the authorization server, if known */
  scopes: string[];
  /** WRD schema of the client's wrdauthServer, if known */
  wrdSchema: string;
  /** Identity at the authorization server, from the id_token (only for OpenID Connect flows) */
  remoteUser: string;
  /** Login name of the local user the authorization was completed for, if the caller recorded it */
  localUser: string;
  data: SessionScopes["system:oauth2"] | null;
}

/** Get a displayable identity from an id_token. Display only: we don't verify the token here */
function getRemoteUser(idToken: string | undefined): string {
  const payload = idToken ? jwt.decode(idToken) : null;
  if (!payload || typeof payload !== "object")
    return "";
  for (const claim of ["preferred_username", "email", "sub"])
    if (typeof payload[claim] === "string" && payload[claim])
      return payload[claim];
  return "";
}

/** List active and recent OAuth2 authorization requests we initiated as a client (the system:oauth2 sessions), most recent first */
export async function listOAuth2Initiations(): Promise<OAuth2Initiation[]> {
  //TODO a listSessions API which understands scope and decodes data would be nice? or two apis, one for raw lists and one for decoding data too ?
  const sessions = await db<PlatformDB>().selectFrom("system.sessions").select(["data", "datablob", "sessionid", "created"]).where("scope", "=", "system:oauth2").execute();
  const withData = await Promise.all(sessions.map(async s => ({ ...s, data: await readAnyFromDatabase(s.data, s.datablob) as SessionScopes["system:oauth2"] | null })));
  return withData.map(s => ({
    created: s.created,
    sessionId: s.sessionid,
    status: s.data?.error ? "failed" as const : s.data?.tokeninfo ? "completed" as const : "pending" as const,
    error: s.data?.error || null,
    clientScope: s.data?.client_scope || "",
    authorizeUrl: s.data?.oauthconfig?.authorizeurl || "",
    scopes: s.data?.scopes || [],
    wrdSchema: s.data?.wrd_schema || "",
    remoteUser: getRemoteUser(s.data?.tokeninfo?.id_token),
    localUser: s.data?.local_user || "",
    data: s.data
  })).toSorted((lhs, rhs) => lhs.created < rhs.created ? 1 : -1);
}

/** Summary of recent OAuth2 initiations for the dashboard (no tokens or other secrets) */
export async function getOAuth2InitiationsForDashboard() {
  return (await listOAuth2Initiations()).map(s => ({
    created: s.created,
    status: s.status,
    error: s.error?.error || "",
    errorDescription: s.error?.error_description || "",
    clientScope: s.clientScope,
    scopes: s.scopes.join(" "),
    wrdSchema: s.wrdSchema,
    remoteUser: s.remoteUser,
    localUser: s.localUser
  }));
}

/** Record the local user an OAuth2 authorization was successfully completed for, so it can be shown when listing initiations.
 * Must be invoked inside work.
 * @param oauth2Session - The oauth2session the landing received
 * @param wrdSchemaTag - Schema containing the user
 * @param entityId - The local user. We record its login name (or #id if the schema has no login attribute)
 */
export async function setOAuth2InitiationLocalUser(oauth2Session: string, wrdSchemaTag: string, entityId: number): Promise<void> {
  const sessdata = await getServerSession("system:oauth2", oauth2Session);
  if (!sessdata)
    return; //expired, nothing to annotate

  const wrdSchema: AnyWRDSchema = wrd(wrdSchemaTag);
  const authSettings = await getAuthSettings(wrdSchema);
  let loginName = "";
  if (authSettings?.loginAttribute)
    loginName = String((await wrdSchema.getFields(authSettings.accountType, entityId, [authSettings.loginAttribute]))?.[authSettings.loginAttribute] ?? "");

  await updateServerSession("system:oauth2", oauth2Session, { ...sessdata, local_user: loginName || `#${entityId}` });
}
