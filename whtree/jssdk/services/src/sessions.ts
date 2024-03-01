import { generateRandomId } from "@webhare/std/platformbased";
import { SessionScopes, WebHareBlob } from "./services";
import { convertWaitPeriodToDate, parseTyped, stringify, type WaitPeriod } from "@webhare/std";
import { db, isWorkOpen, uploadBlob } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";

async function prepareSessionData(indata: NonNullable<object>): Promise<{ data: string; datablob: WebHareBlob | null }> {
  const text = stringify(indata, { typed: true });
  if (text.length <= 4096)
    return { data: text, datablob: null };

  const datablob = WebHareBlob.from(text);
  await uploadBlob(datablob);
  return { data: "json", datablob };
}

async function readAnyFromDatabase(data: string, datablob: WebHareBlob | null): Promise<NonNullable<object>> {
  if (!data && datablob?.size) //JSON data would have had 'json' in the data member
    throw new Error("Attempting to decode HSON data from a session. Set the json: true flag on the session instead!");

  const input = data === "json" ? (await datablob?.text() ?? 'null') : data;
  if (input.startsWith("hson:"))
    throw new Error("Attempting to decode HSON data from a session. Set the json: true flag on the session instead!");

  return parseTyped(input);
}

export interface SessionOptions {
  //Reuse an existing (expired) session id
  sessionId?: string;
  //Session duration. Defaults to 60 minutes
  expires?: WaitPeriod;
}

/** Create a new session
    @param scope - Scope for session (must be unique for each createSession usage so users can't try to trick other getSession users to reveal data)
    @param data - Data to store (needs to be serializable to typed JSON)
    @returns Session id (base64url encoded string)
*/
export async function createSession<S extends string>(scope: S, data: S extends keyof SessionScopes ? SessionScopes[S] : object, options?: SessionOptions): Promise<string> {
  if (!isWorkOpen()) //HareScript would automanage the session for you for backwards compatibility, but it's better to show what happens
    throw new Error(`Can only manage sessions inside open work`);
  if (!scope)
    throw new Error(`No scope specified for session`);

  const created = new Date();
  const expires = convertWaitPeriodToDate(options?.expires || 60 * 1000 * 1000);

  if (options?.sessionId)
    await closeSession(options.sessionId);

  const sessionid = options?.sessionId || generateRandomId();
  const store = await prepareSessionData(data);
  await db<PlatformDB>().insertInto("system.sessions").values({ sessionid, scope, created, expires, autoextend: 0, ...store }).execute();
  return sessionid;
}

/** Get session data
    @param scope - Scope for session
    @param sessionId - Session id. If this session was created in HareScript, make sure it has the json:true option set
    @returns Session data or null if session has expired
*/
export function getSession<S extends keyof SessionScopes>(scope: S, sessionId: string): Promise<SessionScopes[S] | null>;
export function getSession(scope: string, sessionId: string): Promise<object | null>;

export async function getSession(scope: string, sessionId: string): Promise<object | null> {
  const sessdata = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "expires", "data", "datablob", "scope"]).where("sessionid", "=", sessionId).executeTakeFirst();
  if (!sessdata || sessdata.expires < new Date())
    return null;
  if (sessdata.scope !== scope)
    throw new Error(`Incorrect scope '${scope}' for session '${sessionId}'`);
  return await readAnyFromDatabase(sessdata.data, sessdata.datablob);
}

export async function updateSession<S extends string>(scope: S, sessionId: string, data: S extends keyof SessionScopes ? SessionScopes[S] : object): Promise<void> {
  if (!isWorkOpen())
    throw new Error(`Can only manage sessions inside open work`);

  const sessdata = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "expires", "data", "datablob", "scope"]).where("sessionid", "=", sessionId).executeTakeFirst();
  if (!sessdata || sessdata.expires < new Date())
    throw new Error(`Session has already expired`);
  if (sessdata.scope !== scope)
    throw new Error(`Incorrect scope '${scope}' for session '${sessionId}'`);

  const store = await prepareSessionData(data);
  await db<PlatformDB>().updateTable("system.sessions").where("sessionid", "=", sessionId).set(store).execute();
}

/** Close session
 * @param sessionId - Session id to close
 */
export async function closeSession(sessionId: string) {
  if (!isWorkOpen())
    throw new Error(`Can only manage sessions inside open work`);
  await db<PlatformDB>().deleteFrom("system.sessions").where("sessionid", "=", sessionId).execute();
}
