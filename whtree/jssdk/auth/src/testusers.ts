/* Temporary test users for developers. Not exported through @webhare/auth (yet) */

import { loadlib } from "@webhare/harescript/src/contextvm";
import type { HSVMObject } from "@webhare/harescript/src/harescript";
import { backendConfig, createServerSession, getServerSession } from "@webhare/services";
import { throwError } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { wrd, type WRDSchemaLike, type WRDSchemaType } from "@webhare/wrd";
import { writeAuthAuditEvent } from "./audit";
import { IdentityProvider, prepareLogin, type SetAuthCookies } from "./identity";
import { getAuthSettings } from "./settings";
import { prepAuthForURL } from "./support";
import { ensureAuthObject, getAuthorizationInterface } from "./userrights";

declare module "@webhare/services" {
  interface SessionScopes {
    "platform:testuserlogin": {
      /** Schema containing the test user */
      wrdSchema: string;
      /** The test user to log in */
      userId: number;
      /** URL to redirect to after setting the cookies */
      target: string;
      /** When the login link expires */
      expires: Temporal.Instant;
    };
  }
}

type UserMgmtSchema = WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;

/** wrdTag of the unit containing all test users */
export const testUsersUnitTag = "WEBHARE_TEST_USERS";
/** Domain used for test user logins */
export const testUserDomain = "beta.webhare.net";
/** Prefix used by createTestUserLoginLink for URLs that should point to the local installation */
const localInstallationPrefix = "https://my.webhare.dev/";

/** Expected failures (bad user, role or link) that callers can report without a stack trace */
export class TestUserError extends Error {
}

const firstNames = [
  "Anna", "Ben", "Charlotte", "David", "Emma", "Finn", "Grace", "Henry", "Isabel", "Jack",
  "Julia", "Lars", "Laura", "Liam", "Lucas", "Maria", "Mila", "Noah", "Olivia", "Peter",
  "Sara", "Sem", "Sophie", "Thomas", "Tim", "Eva", "Daan", "Noor", "Max", "Lotte"
];

const lastNames = [
  "Bakker", "Brown", "de Boer", "de Jong", "de Vries", "Davis", "Garcia", "Jansen", "Johnson", "Jones",
  "Smit", "Martin", "Meijer", "Miller", "Mulder", "Peters", "Smith", "Taylor", "van Dijk", "Visser",
  "Williams", "Wilson", "Bos", "Vos", "Dekker", "Brouwer", "Hendriks", "Clark", "Walker", "Young"
];

export interface TestUser {
  wrdId: number;
  wrdGuid: string;
  /** Login name (and email address) of the test user */
  username: string;
  /** When the test user will be closed */
  expires: Temporal.Instant;
}

export interface CreateTestUserOptions {
  /** WRD schema to create the user in. Defaults to the primary user management schema */
  schema?: string;
  /** Global rights to grant to the user, in addition to platform:debug which test users always get */
  rights?: string[];
  /** Roles to grant to the user, specified by wrdTag or title */
  roles?: string[];
}

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Get the tag of the primary user management schema (the one used to log into the WebHare backend) */
export async function getPrimaryUserSchemaTag(): Promise<string> {
  const primaryPlugin = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareAuthPlugin() as HSVMObject;
  return await (await primaryPlugin.$get<HSVMObject>("wrdschema")).$get<string>("tag");
}

async function openSchema(schema?: string): Promise<UserMgmtSchema> {
  return wrd<WRDSchemaLike["system:usermgmt"]>(schema || await getPrimaryUserSchemaTag());
}

type AnyUserSchema = WRDSchemaType<WRDSchemaLike["*"]>;

interface TestUserSchemaInfo {
  /** Schema for the usermgmt types (units, roles) */
  wrdSchema: UserMgmtSchema;
  /** Untyped schema for the account type, as its login and email fields depend on the schema */
  anySchema: AnyUserSchema;
  loginAttribute: string;
  emailAttribute: string | null;
}

async function getTestUserSchemaInfo(wrdSchema: UserMgmtSchema): Promise<TestUserSchemaInfo> {
  const authsettings = await getAuthSettings(wrdSchema);
  if (!authsettings)
    throw new TestUserError(`WRD schema '${wrdSchema.tag}' is not configured for authentication`);
  if (authsettings.accountType !== "wrdPerson")
    throw new TestUserError(`WRD schema '${wrdSchema.tag}' uses '${authsettings.accountType}' for accounts, test users require 'wrdPerson'`);
  if (!authsettings.loginAttribute)
    throw new TestUserError(`WRD schema '${wrdSchema.tag}' has no login attribute`);
  if (!authsettings.hasWhuserUnit)
    throw new TestUserError(`WRD schema '${wrdSchema.tag}' has no units, test users require a 'whuserUnit' type`);

  return {
    wrdSchema,
    anySchema: wrd<"*">(wrdSchema.tag),
    loginAttribute: authsettings.loginAttribute,
    emailAttribute: authsettings.emailAttribute
  };
}

/** Ensure the unit holding all test users exists. Requires open work
 * @returns The id of the test users unit
 */
export async function ensureTestUsersUnit(wrdSchema: UserMgmtSchema): Promise<number> {
  const [unitId] = await wrdSchema.upsert("whuserUnit", { wrdTag: testUsersUnitTag }, {}, { ifNew: { wrdTitle: "Test Users" } });
  return unitId;
}

async function getNextTestUserNumber(info: TestUserSchemaInfo): Promise<number> {
  //Include closed users so we never reuse a login that's still retained
  const existing = await info.anySchema.query("wrdPerson").
    where(info.loginAttribute, "like", `test*@${testUserDomain}`).
    select(info.loginAttribute).
    historyMode("all").
    execute() as string[];

  let highest = 0;
  for (const login of existing) {
    const match = login.match(/^test(\d+)@/);
    if (match)
      highest = Math.max(highest, parseInt(match[1]));
  }
  return highest + 1;
}

async function grantRightsAndRoles(wrdSchema: UserMgmtSchema, userId: number, rights: string[], roles: string[]) {
  //Look up the roles first so we can fail before granting anything
  const roleIds: number[] = [];
  for (const role of roles) {
    const matches = new Set([
      ...await wrdSchema.query("whuserRole").where("wrdTag", "=", role).select("wrdId").execute(),
      ...await wrdSchema.query("whuserRole").where("wrdTitle", "=", role).select("wrdId").execute()
    ]);
    if (matches.size === 0)
      throw new TestUserError(`No role with tag or title '${role}' in schema '${wrdSchema.tag}'`);
    if (matches.size > 1)
      throw new TestUserError(`Multiple roles match '${role}' in schema '${wrdSchema.tag}'`);
    roleIds.push([...matches][0]);
  }

  await ensureAuthObject(getAuthorizationInterface(userId));

  /* There's no TS API to grant rights and roles yet, so we use the HareScript APIs. We grant as the override user
     (which is created at startup and always has system:sysop) as granting roles requires system:manageroles */
  const hsWRDSchema = await loadlib("mod::wrd/lib/api.whlib").openWRDSchema(wrdSchema.tag);
  const userApi = await loadlib("mod::wrd/lib/auth.whlib").GetWRDAuthUserAPI(hsWRDSchema);
  const grantor = await loadlib("mod::system/lib/internal/backend/users.whlib").EnsureCreatedMagicSysop("<overrideuser>");

  /* We created the user and its unit through the raw WRD API, which doesn't build the authorization objects the
     usermgmt UI needs. Sync them (both the user and its unit) so eg. New User/New Role stay enabled on the unit */
  await userApi.SyncUserAfterUpdate(userId);

  const grantee = await userApi.GetUser(userId);
  const comment = "Granted by createTestUser";

  for (const right of rights)
    await grantor.UpdateGrant("grant", right, 0, grantee, { comment });

  for (const roleId of roleIds) {
    const roleAuthObjectId = await (await userApi.GetRole(roleId) as HSVMObject).$get<number>("authobjectid");
    if (!roleAuthObjectId)
      throw new Error(`Role #${roleId} has no corresponding authobject`);
    await grantor.UpdateRoleGrant("grant", roleAuthObjectId, grantee, { comment });
  }
}

/** Create a temporary test user. The user is closed when a login started now would expire (by default: the next day)
 * @param options - Schema, rights and roles for the new user
 * @returns The new user
 */
export async function createTestUser(options?: CreateTestUserOptions): Promise<TestUser> {
  const info = await getTestUserSchemaInfo(await openSchema(options?.schema));
  const { wrdSchema } = info;
  //Test users are used to verify changes, so always give them access to the debugging options
  const rights = [...new Set(["platform:debug", ...options?.rights || []])];
  const roles = options?.roles || [];

  //Close the user when a normal first party login would expire
  const expires = await new IdentityProvider(wrdSchema).getExpiration(Temporal.Now.instant()) ?? throwError("Login expiration not set");

  /* Hold the usermgmt mutex (the same one userApi.Create* takes) for the whole transaction so concurrent
     creations don't pick the same unit or username. We don't use the locking userApi.Create* here ourselves */
  return await runInWork(async () => {
    const unitId = await ensureTestUsersUnit(wrdSchema);
    const username = `test${await getNextTestUserNumber(info)}@${testUserDomain}`;

    const wrdId = await info.anySchema.insert("wrdPerson", {
      [info.loginAttribute]: username,
      ...(info.emailAttribute ? { [info.emailAttribute]: username } : {}),
      wrdFirstName: pickRandom(firstNames),
      wrdLastName: pickRandom(lastNames),
      whuserUnit: unitId,
      wrdauthAccountStatus: { status: "active", since: Temporal.Now.instant() },
      wrdClosed: expires
    });

    await grantRightsAndRoles(wrdSchema, wrdId, rights, roles);

    await writeAuthAuditEvent(wrdSchema, {
      type: "platform:testuser-created",
      entity: wrdId,
      entityLogin: username,
      data: { rights, roles, expires }
    });

    const { wrdGuid } = await wrdSchema.getFields("wrdPerson", wrdId, ["wrdGuid"]);
    return { wrdId, wrdGuid, username, expires };
  }, { mutex: "wrd:usermgmt" });
}

/** Find a test user
 * @param spec - The user's wrdId, wrdGuid, login name, or login name without the `@beta.webhare.net` suffix
 * @param options - Schema to search. Defaults to the primary user management schema
 * @returns The test user
 * @throws If the user doesn't exist or isn't a test user
 */
export async function findTestUser(spec: string, options?: { schema?: string }): Promise<TestUser> {
  const info = await getTestUserSchemaInfo(await openSchema(options?.schema));
  const { wrdSchema } = info;

  const [matchField, matchValue]: [string, string | number] =
    /^\d+$/.test(spec) ? ["wrdId", parseInt(spec)]
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spec) ? ["wrdGuid", spec.toLowerCase()]
        : [info.loginAttribute, spec.includes("@") ? spec : `${spec}@${testUserDomain}`];

  const user = (await info.anySchema.query("wrdPerson").select({
    wrdId: "wrdId",
    wrdGuid: "wrdGuid",
    username: info.loginAttribute,
    whuserUnit: "whuserUnit",
    wrdClosed: "wrdClosed"
  }).where(matchField, "=", matchValue).execute())[0] as { wrdId: number; wrdGuid: string; username: string; whuserUnit: number | null; wrdClosed: Temporal.Instant | null } | undefined;
  if (!user)
    throw new TestUserError(`No user '${spec}' in schema '${wrdSchema.tag}'`);

  const unitTag = user.whuserUnit ? (await wrdSchema.getFields("whuserUnit", user.whuserUnit, ["wrdTag"])).wrdTag : "";
  if (unitTag !== testUsersUnitTag || !user.wrdClosed)
    throw new TestUserError(`User '${spec}' in schema '${wrdSchema.tag}' is not a test user`);

  return { wrdId: user.wrdId, wrdGuid: user.wrdGuid, username: user.username, expires: user.wrdClosed };
}

/** Create a link that logs in a test user and then redirects to the specified URL
 * @param user - Test user to log in (see findTestUser for the accepted formats)
 * @param link - URL to redirect to. A link starting with https://my.webhare.dev/ will be rewritten to point to this installation's backend
 * @param options - Schema containing the user. Defaults to the primary user management schema
 * @returns The login link and its expiry, which matches the user's expiry
 */
export async function createTestUserLoginLink(user: string | number, link: string, options?: { schema?: string }): Promise<{ loginLink: string; expires: Temporal.Instant }> {
  const wrdSchema = await openSchema(options?.schema);
  const testUser = await findTestUser(String(user), { schema: wrdSchema.tag });

  if (link.startsWith(localInstallationPrefix)) {
    if (!backendConfig.backendURL)
      throw new TestUserError(`Cannot rewrite '${link}' as this installation has no backend URL configured`);
    link = backendConfig.backendURL + link.substring(localInstallationPrefix.length);
  }

  const target = URL.parse(link);
  if (target?.protocol !== "https:" && target?.protocol !== "http:")
    throw new TestUserError(`Invalid link '${link}'`);

  //Verify the target logs in to our schema now, so we can fail at creation instead of silently on redemption
  const prepped = await prepAuthForURL(target.toString(), null);
  if ("error" in prepped)
    throw new TestUserError(`Cannot log in at '${link}': ${prepped.error}`);
  if (prepped.settings.wrdSchema !== wrdSchema.tag)
    throw new TestUserError(`'${link}' uses WRD schema '${prepped.settings.wrdSchema}' for logins but the test user is in '${wrdSchema.tag}'`);

  /* Store only the identity and target: a fresh login token is minted on each redemption (see redeemTestUserLogin)
     so the link keeps working after a logout and gives every browser its own independent token */
  const sessionId = await runInWork(() => createServerSession("platform:testuserlogin", {
    wrdSchema: wrdSchema.tag,
    userId: testUser.wrdId,
    target: target.toString(),
    expires: testUser.expires
  }, { expires: testUser.expires }));

  return { loginLink: `${target.origin}/.wh/auth/testlogin/${sessionId}`, expires: testUser.expires };
}

/** Redeem a test user login link: look up the stored session and mint a fresh login token for it.
 * @param sessionId - The session id from the login link
 * @returns The cookies to set and the URL to redirect to, or null if the link is unknown or expired
 */
export async function redeemTestUserLogin(sessionId: string): Promise<{ setAuth: SetAuthCookies; target: string } | null> {
  const loginInfo = await getServerSession("platform:testuserlogin", sessionId);
  if (!loginInfo || loginInfo.expires.epochMilliseconds < Date.now())
    return null;

  const prepped = await prepAuthForURL(loginInfo.target, null);
  if ("error" in prepped || prepped.settings.wrdSchema !== loginInfo.wrdSchema)
    return null;

  const setAuth = await prepareLogin(prepped, loginInfo.userId, { expires: loginInfo.expires });
  return { setAuth, target: loginInfo.target };
}
