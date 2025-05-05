import { defaultDateTime, encodeHSON } from "@webhare/hscompat";
import { generateRandomId } from "@webhare/std";
import * as test from "@webhare/test";
import { AuthenticationSettings } from "@webhare/wrd";
import { checkAuthenticationSettings, checkPasswordCompliance, describePasswordChecks, getPasswordBreachCount, getPasswordMinValidFrom, parsePasswordChecks } from "@webhare/auth/src/passwords";

async function testPasswordBreachCount() {
  test.assert(await getPasswordBreachCount("secret") > 0);
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
  test.eq("", (await checkPasswordCompliance("", "")).message);
  test.eq("", (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "aBC456#()@")).message);
  test.eq(/10.*characters.*1.*lowercase.*3.*digits/s, (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "BC46#()@")).message);
  test.eq(["minlength", "lowercase", "digits"], (await checkPasswordCompliance("lowercase:1 uppercase:2 digits:3 symbols:4 minlength:10", "BC46#()@")).failedchecks);

  // test reuse
  test.eq("", (await checkPasswordCompliance("noreuse:P2D", "secret", {
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
  })).message);

  test.eq(/not.*reused.*2.*days/, (await checkPasswordCompliance("noreuse:P2D", "secret", {
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
  })).message);
}

function testCheckAuthenticationSettings() {
  test.eq("", (checkAuthenticationSettings("maxage:P2D", AuthenticationSettings.fromHSON(encodeHSON({
    version: 1,
    passwords: [
      {
        validfrom: new Date(Date.now() + 5000 - 2 * 86400_000),
        passwordhash: "PLAIN:secret"
      }
    ]
  })))).message);

  test.eq(/changed.*every.*2.*days/, (checkAuthenticationSettings("maxage:P2D", AuthenticationSettings.fromHSON(encodeHSON({
    version: 1,
    passwords: [
      {
        validfrom: new Date(Date.now() - 5000 - 2 * 86400_000),
        passwordhash: "PLAIN:secret"
      }
    ]
  })))).message);
}

test.run([
  testPasswordBreachCount,
  testCheckParser,
  testGetPasswordMinValueFrom,
  testDescribePasswordChecks,
  testCheckPassword,
  testCheckAuthenticationSettings
]);
