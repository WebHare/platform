import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createTestUser, createTestUserLoginLink, findTestUser, TestUserError } from "@webhare/auth/src/testusers";
import { getAuthorizationInterface } from "@webhare/auth";
import { ensureAuthObject } from "@webhare/auth/src/userrights";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { loadlib } from "@webhare/harescript/src/contextvm";
import type { HSVMObject } from "@webhare/harescript/src/harescript";
import { backendConfig, toResourcePath } from "@webhare/services";
import { escapeRegExp, throwError } from "@webhare/std";
import { db, runInWork } from "@webhare/whdb";
import { createSchema, wrd, type WRDSchemaLike } from "@webhare/wrd";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

//The JS testsite logs in using this schema, so we can test login links against it
const schema = "webhare_testsuite:testschema";
const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>(schema);
//A schema only used for website logins, without units (and therefore without rights or roles)
const noUnitsSchema = "webhare_testsuite:nounits";
let roleAuthObjectId = 0;
let regularUserId = 0;

async function setup() {
  await test.resetWTS();
  await runInWork(async () => {
    await createSchema(schema, { schemaDefinitionResource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml") });

    //Create a regular unit with a user and a role to grant. Units and roles need HareScript-created authobjects so use the userapi
    const userApi = await loadlib("mod::wrd/lib/auth.whlib").GetWRDAuthUserAPI(await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchema(schema));
    const unitId = await userApi.CreateUnit({ wrd_title: "Regular unit" });
    regularUserId = await userApi.CreateUser({ whuser_unit: unitId, wrd_contact_email: "regular@beta.webhare.net" });
    const roleId = await userApi.CreateRole({ wrd_leftentity: unitId, wrd_title: "Testusers role", wrd_tag: "TESTUSERS_ROLE" });
    roleAuthObjectId = await (await userApi.GetRole(roleId) as HSVMObject).$get<number>("authobjectid");

    await createSchema(noUnitsSchema, { schemaDefinitionResource: toResourcePath(__dirname + "/data/nounits.wrdschema.xml") });
  });
}

// Verifies the test users created by createTestUser and the audit trail it leaves
async function testCreateTestUser() {
  const start = Temporal.Now.instant();

  ////////////////////////////////////////////////////////////////
  // STORY: A test user is created in the test users unit, closing when a login started now would expire
  const expectExpires = await new IdentityProvider(testSchema).getExpiration("id", Temporal.Now.instant());
  const user1 = await createTestUser({ schema, rights: ["system:sysop"], roles: ["TESTUSERS_ROLE"] });
  test.eq(/^test\d+@beta\.webhare\.net$/, user1.username);
  test.eq(expectExpires!, user1.expires);

  const fields = await testSchema.getFields("wrdPerson", user1.wrdId, ["wrdGuid", "wrdClosed", "whuserUnit", "wrdFirstName", "wrdLastName"]);
  test.eq(user1.wrdGuid, fields.wrdGuid);
  test.eq(user1.expires, fields.wrdClosed);
  test.assert(fields.wrdFirstName && fields.wrdLastName, "Test users should get a name");
  test.eq("WEBHARE_TEST_USERS", (await testSchema.getFields("whuserUnit", fields.whuserUnit, ["wrdTag"])).wrdTag);

  ////////////////////////////////////////////////////////////////
  // STORY: The requested rights and roles are granted, and platform:debug is always granted
  test.eq(true, await getAuthorizationInterface(user1.wrdId).hasRight("system:sysop"));
  test.eq(true, await getAuthorizationInterface(user1.wrdId).hasRight("platform:debug"));
  const userAuthObjectId = await runInWork(() => ensureAuthObject(getAuthorizationInterface(user1.wrdId)));
  const roleGrants = await db<PlatformDB>().selectFrom("system.rolegrants").select("role").where("grantee", "=", userAuthObjectId).execute();
  test.eq([{ role: roleAuthObjectId }], roleGrants);

  ////////////////////////////////////////////////////////////////
  // STORY: The creation is recorded in the audit log
  test.eqPartial({
    entity: user1.wrdId,
    entityLogin: user1.username,
    data: { rights: ["platform:debug", "system:sysop"], roles: ["TESTUSERS_ROLE"], expires: user1.expires }
  }, await test.getLastAuthAuditEvent(testSchema, { type: "platform:testuser-created", since: start }));

  ////////////////////////////////////////////////////////////////
  // STORY: The next test user gets the next number and shares the unit
  const user2 = await createTestUser({ schema });
  test.eq(parseInt(user1.username.substring(4)) + 1, parseInt(user2.username.substring(4)));
  test.eq(fields.whuserUnit, (await testSchema.getFields("wrdPerson", user2.wrdId, ["whuserUnit"])).whuserUnit);
  test.eq(1, (await testSchema.query("whuserUnit").select("wrdId").where("wrdTag", "=", "WEBHARE_TEST_USERS").execute()).length);
  test.eq(false, await getAuthorizationInterface(user2.wrdId).hasRight("system:sysop"));
  test.eq(true, await getAuthorizationInterface(user2.wrdId).hasRight("platform:debug"));

  ////////////////////////////////////////////////////////////////
  // STORY: Unknown roles are rejected before anything is created
  await test.throws(/No role with tag or title 'NO_SUCH_ROLE'/, createTestUser({ schema, roles: ["NO_SUCH_ROLE"] }));
}

// Verifies the different ways to refer to a test user, and that real users are refused
async function testFindTestUser() {
  const user = await createTestUser({ schema });
  const shortName = user.username.split("@")[0];

  for (const spec of [String(user.wrdId), user.wrdGuid, user.wrdGuid.toUpperCase(), user.username, shortName])
    test.eq(user, await findTestUser(spec, { schema }), `Looking up '${spec}'`);

  await test.throws(e => e instanceof TestUserError && /No user 'test999999'/.test(e.message), findTestUser("test999999", { schema }));
  await test.throws(/is not a test user/, findTestUser(String(regularUserId), { schema }));
  await test.throws(/is not a test user/, findTestUser("regular", { schema }));
}

// Verifies test users in a schema without units, which can't be granted rights or roles
async function testSchemaWithoutUnits() {
  const start = Temporal.Now.instant();
  const anySchema = wrd<"*">(noUnitsSchema);

  ////////////////////////////////////////////////////////////////
  // STORY: A test user is created without a unit and without rights (not even platform:debug)
  const user = await createTestUser({ schema: noUnitsSchema });
  test.eq(/^test\d+@beta\.webhare\.net$/, user.username);
  test.eqPartial({ wrdContactEmail: user.username, wrdClosed: user.expires }, await anySchema.getFields("wrdPerson", user.wrdId, ["wrdContactEmail", "wrdClosed"]));
  test.eqPartial({
    entity: user.wrdId,
    entityLogin: user.username,
    data: { rights: [], roles: [], expires: user.expires }
  }, await test.getLastAuthAuditEvent(anySchema, { type: "platform:testuser-created", since: start }));

  const user2 = await createTestUser({ schema: noUnitsSchema });
  test.eq(parseInt(user.username.substring(4)) + 1, parseInt(user2.username.substring(4)));

  ////////////////////////////////////////////////////////////////
  // STORY: Rights and roles are rejected before anything is created
  const countUsers = async () => (await anySchema.query("wrdPerson").select("wrdId").historyMode("all").execute()).length;
  const numUsers = await countUsers();
  await test.throws(e => e instanceof TestUserError && /has no units/.test(e.message), createTestUser({ schema: noUnitsSchema, rights: ["system:sysop"] }));
  await test.throws(e => e instanceof TestUserError && /has no units/.test(e.message), createTestUser({ schema: noUnitsSchema, roles: ["TESTUSERS_ROLE"] }));
  test.eq(numUsers, await countUsers());

  ////////////////////////////////////////////////////////////////
  // STORY: Test users are recognized by their generated login and closing date
  for (const spec of [String(user.wrdId), user.wrdGuid, user.username, user.username.split("@")[0]])
    test.eq(user, await findTestUser(spec, { schema: noUnitsSchema }), `Looking up '${spec}'`);

  const { notClosedId, otherLoginId } = await runInWork(async () => ({
    //Looks like a test user's login, but test users always have a closing date
    notClosedId: await anySchema.insert("wrdPerson", { wrdContactEmail: "test999998@beta.webhare.net" }),
    //Has a closing date, but isn't a test user's login
    otherLoginId: await anySchema.insert("wrdPerson", { wrdContactEmail: "closing@beta.webhare.net", wrdClosed: user.expires })
  }));
  await test.throws(/is not a test user/, findTestUser(String(notClosedId), { schema: noUnitsSchema }));
  await test.throws(/is not a test user/, findTestUser("test999998", { schema: noUnitsSchema }));
  await test.throws(/is not a test user/, findTestUser(String(otherLoginId), { schema: noUnitsSchema }));
}

/** Extract the (server-side) ID token cookie set by a test login redemption */
function getIdTokenCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find(c => c.includes("accessToken%3A")) ?? throwError("Expected the ID token cookie to be set");
  return cookie.split(";")[0];
}

// Verifies the autologin links created by createTestUserLoginLink
async function testLoginLink() {
  const url = (await test.getTestSiteJS()).webRoot ?? throwError("No webroot for JS testsite");
  const user = await createTestUser({ schema });

  ////////////////////////////////////////////////////////////////
  // STORY: Following the link sets the login cookies and redirects to the target
  const target = url + "?testusers=1";
  const { loginLink, expires } = await createTestUserLoginLink(user.username, target, { schema });
  test.eq(new RegExp(`^${escapeRegExp(new URL(url).origin)}/\\.wh/auth/testlogin/`), loginLink);
  test.eq(user.expires, expires, "The login shouldn't outlive the test user");

  const response = await fetch(loginLink, { redirect: "manual" });
  test.eq(302, response.status);
  test.eq(target, response.headers.get("location"));
  const firstToken = getIdTokenCookie(response);

  ////////////////////////////////////////////////////////////////
  // STORY: Each redemption mints a fresh token, so the link keeps working after a logout and across browsers
  const reuse = await fetch(loginLink, { redirect: "manual" });
  test.eq(302, reuse.status);
  test.assert(getIdTokenCookie(reuse) !== firstToken, "Each redemption should mint its own token");
  test.eq(410, (await fetch(loginLink + "x", { redirect: "manual" })).status);

  ////////////////////////////////////////////////////////////////
  // STORY: my.webhare.dev links refer to this installation's backend (which doesn't log in to the testsuite schema)
  await test.throws(new RegExp(`^'${escapeRegExp(backendConfig.backendURL)}.wh/` + ".* uses WRD schema"), createTestUserLoginLink(user.username, "https://my.webhare.dev/.wh/", { schema }));
}

test.runTests([
  setup,
  testCreateTestUser,
  testFindTestUser,
  testSchemaWithoutUnits,
  testLoginLink
]);
