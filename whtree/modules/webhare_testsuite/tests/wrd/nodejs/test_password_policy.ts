import { defaultDateTime, encodeHSON } from "@webhare/hscompat";
import { generateRandomId, throwError } from "@webhare/std";
import * as test from "@webhare/test";
import { AuthenticationSettings, updateSchemaSettings, wrd } from "@webhare/wrd";
import { checkPasswordCompliance, describePasswordChecks, getPasswordBreachCount, getPasswordMinValidFrom, parsePasswordChecks, verifyPasswordCompliance } from "@webhare/auth/src/passwords";
import { beginWork, commitWork, db, rollbackWork, runInWork } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getUserValidationSettings } from "@webhare/auth/src/support";

const wrdTestschemaSchema = wrd("wrd:testschema");

async function testPasswordBreachCount() {
  test.assert(await getPasswordBreachCount("a") > 700000);
  test.assert(await getPasswordBreachCount("secret") > 1000000);
  test.eq(0, await getPasswordBreachCount(generateRandomId()));
}

function testCheckParser() {
  test.eq([
    { check: "hibp", value: 0, duration: "" },
    { check: "minlength", value: 1, duration: "" },
    { check: "lowercase", value: 2, duration: "" },
    { check: "uppercase", value: 3, duration: "" },
    { check: "digits", value: 4, duration: "" },
    { check: "symbols", value: 5, duration: "" },
    { check: "maxage", value: 0, duration: "PT01H" },
    { check: "noreuse", value: 0, duration: "PT02H" }
  ], parsePasswordChecks("lowercase:2 noreuse:PT02H digits:4 uppercase:3 minlength:1 symbols:5 hibp maxage:PT01H"));

  test.eq([{ check: "minlength", value: 1, duration: "" }],
    parsePasswordChecks("invalid  minlength:1 maxage:15 invalid "));

  test.throws(/syntax/, () => parsePasswordChecks("invalid", { strict: true }));

  test.eq([{ check: "externallogin", value: 0, duration: "" }],
    parsePasswordChecks("externallogin"));
}

function testGetPasswordMinValueFrom() {
  const now = Temporal.Instant.from("2024-02-28T09:54:56.120Z");
  test.eq(Temporal.Instant.from("2022-12-25T08:52:53.116Z"), getPasswordMinValidFrom("P1Y2M3DT1H2M3.004S", { now }));
}

function testDescribePasswordChecks() {
  const res = describePasswordChecks("lowercase:2 noreuse:P02D digits:4 uppercase:3 minlength:1 symbols:5 hibp maxage:P01D");
  test.eq(new RegExp(`The new password.*
- .*not.*database.*of.*compromised.*passwords.*
- .*1.*characters.*or.*longer.*
- .*2.*lowercase.*
- .*3.*uppercase.*
- .*4.*digits.*
- .*5.*symbols.*
- .*changed.*every.*1.*day.*
- .*not.*reused.*2.*days*`), res);
}

async function testCheckPassword() {
  test.eq(true, (await checkPasswordCompliance("", "")).success);
  test.eq(true, (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "aBC456#()@")).success);
  test.eqPartial({ message: /10.*characters.*1.*lowercase.*3.*digits/s }, (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "BC46#()@")));
  test.eqPartial({ failedChecks: ["minlength", "lowercase", "digits"] }, (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "BC46#()@")));

  // test reuse
  test.eq(true, (await checkPasswordCompliance("noreuse:P2D", "secret", {
    authenticationSettings: AuthenticationSettings.fromHSON(encodeHSON({
      version: 1,
      passwords: [
        {
          validfrom: defaultDateTime,
          passwordhash: "PLAIN:secret"
        }, {
          validfrom: new Date(Date.now() - 5000 - 2 * 86400_000),
          passwordhash: "*"
        }
      ]
    }))
  })).success);

  test.eqPartial({ message: /not.*reused.*2.*days/ }, (await checkPasswordCompliance("noreuse:P2D", "secret", {
    authenticationSettings: AuthenticationSettings.fromHSON(encodeHSON({
      version: 1,
      passwords: [
        {
          validfrom: defaultDateTime, passwordhash: "PLAIN:secret"
        }, {
          validfrom: new Date(Date.now() + 5000 - 2 * 86400_000),
          passwordhash: "*"
        }
      ]
    }))
  })));

  test.eq({ success: true }, await checkPasswordCompliance("maxage:P2D", "secret", {
    isCurrentPassword: true, authenticationSettings: AuthenticationSettings.fromHSON(encodeHSON({
      version: 1,
      passwords: [
        {
          validfrom: new Date(Date.now() + 5000 - 2 * 86400_000),
          passwordhash: "PLAIN:secret"
        }
      ]
    }))
  }));

  test.eqPartial({ success: false, message: /changed.*every.*2.*days/, failedChecks: ["maxage"] }, await checkPasswordCompliance("maxage:P2D", "secret", {
    isCurrentPassword: true, authenticationSettings: AuthenticationSettings.fromHSON(encodeHSON({
      version: 1,
      passwords: [
        {
          validfrom: new Date(Date.now() - 5000 - 2 * 86400_000),
          passwordhash: "PLAIN:secret"
        }
      ]
    }))
  }));
}

async function testSettingOverrides() {
  await beginWork();
  await updateSchemaSettings(wrdTestschemaSchema, { passwordValidationChecks: "hibp" });
  const baseUnit = await wrdTestschemaSchema.insert("whuserUnit", { wrdLeftEntity: null, overridePasswordchecks: true, passwordchecks: "uppercase:1" });
  const subUnit = await wrdTestschemaSchema.insert("whuserUnit", { wrdLeftEntity: baseUnit, overridePasswordchecks: false, passwordchecks: "lowercase:1" });
  const subSubUnit = await wrdTestschemaSchema.insert("whuserUnit", { wrdLeftEntity: subUnit, overridePasswordchecks: true, passwordchecks: "symbols:1" });

  test.eq("hibp", await getUserValidationSettings(wrdTestschemaSchema, null));
  test.eq("uppercase:1", await getUserValidationSettings(wrdTestschemaSchema, baseUnit));
  test.eq("uppercase:1", await getUserValidationSettings(wrdTestschemaSchema, subUnit));
  test.eq("symbols:1", await getUserValidationSettings(wrdTestschemaSchema, subSubUnit));
  await rollbackWork();
}

async function testCompleteAccountExpiry() {
  await beginWork();
  const unit = await wrdTestschemaSchema.insert("whuserUnit", { wrdLeftEntity: null, overridePasswordchecks: true, passwordchecks: "minlength:20" });
  const user = await wrdTestschemaSchema.insert("wrdPerson", { wrdContactEmail: `complete-${generateRandomId().toLowerCase()}@beta.webhare.net`, whuserUnit: unit, wrdauthAccountStatus: { status: "active" } });
  await commitWork();

  //A password that fails the unit's checks sends the user to complete the account, which should be possible for one hour
  const start = Date.now();
  const authsettings = AuthenticationSettings.fromHSON(encodeHSON({ version: 1, passwords: [{ validfrom: new Date, passwordhash: "PLAIN:short" }] }));
  const sessionId = await verifyPasswordCompliance(wrdTestschemaSchema, user, unit, "short", authsettings, "", { clientIp: "1.2.3.4", browserTriplet: "ios-safari-1" }) ?? throwError("Expected an incomplete-account session");
  const session = await db<PlatformDB>().selectFrom("system.sessions").select(["expires"]).where("sessionid", "=", sessionId).executeTakeFirstOrThrow();
  test.assert(Math.abs(session.expires.getTime() - (start + 3600_000)) < 60_000, `Expected the session to expire in one hour, got ${session.expires.toISOString()}`);

  await runInWork(async () => {
    await wrdTestschemaSchema.delete("wrdPerson", user);
    await wrdTestschemaSchema.delete("whuserUnit", unit);
  });
}

test.runTests([
  testCompleteAccountExpiry,
  testPasswordBreachCount,
  testCheckParser,
  testGetPasswordMinValueFrom,
  testDescribePasswordChecks,
  testCheckPassword,
  testSettingOverrides
]);
