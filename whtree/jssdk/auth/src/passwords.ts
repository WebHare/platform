import * as crypto from "node:crypto";
import { parseDuration, subtractDuration } from "@webhare/std";
import { AuthenticationSettings, type WRDSchema } from "@webhare/wrd";
import { getTid } from "@webhare/gettid";
import { getUserValidationSettings } from "./support";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";
import { runInWork } from "@webhare/whdb";
import { createServerSession } from "@webhare/services";
import { writeAuthAuditEvent, type AuthAuditContext } from "@webhare/auth";

export type PasswordCheck = "externallogin" | "hibp" | "minlength" | "lowercase" | "uppercase" | "digits" | "symbols" | "maxage" | "noreuse" | "require2fa";

export type PasswordCheckResult = {
  success: false;
  message: string;
  failedChecks: PasswordCheck[];
  badPasswordTime: Temporal.Instant | null;
} | {
  success: true;
};

/** Parse password checks
    @param checks - Password validation checks. Space-separated list of checks. Possible checks:
    - hibp Check that the password isn't present in the "Have I Been Pwned" database
    - minlength:(amount) Make sure that password has at least (amount) characters
    - lowercase:(amount) Make sure that password has at least (amount) lowercase characters
    - uppercase:(amount) Make sure that password has at least (amount) uppercase characters
    - digits:(amount) Make sure that password has at least (amount) digits
    - symbols:(amount) Make sure that password has at least (amount) symbols
    @param strict - Throw on errors, defaults to FALSE
    @returns Parsed list of checks
      return.check Token of the check ("hibp", "minlength", "lowercase", "uppercase", "digits", "symbols", "maxage", "noreuse")
      return.value Amount (for checks that have an amount).
      return.duration Duration string (for checks that have an duration).
*/
export function parsePasswordChecks(checks: string, options: { strict?: boolean } = {}): Array<{
  check: PasswordCheck;
  value: number;
  duration: string;
}> {
  const retval = [];
  for (const token of checks.split(" ")) {
    try {
      const parts = token.split(":");
      if (parts.length !== (["", "hibp", "require2fa", "externallogin"].includes(parts[0]) ? 1 : 2))
        throw new Error(`Password check '${token}' has a syntax error`);

      let value = parts.length === 2 ? parseInt(parts[1], 10) : 0;
      let duration = '';
      if (["maxage", "noreuse"].includes(parts[0])) {
        try {
          parseDuration(parts[1]);
        } catch {
          throw new Error(`Password check '${token}' has an invalid duration`);
        }
        value = 0;
        duration = parts[1];
      } else if (value < 0)
        throw new Error(`Password check '${token}' has an invalid count`);

      switch (parts[0]) {
        case "":
          continue;
        case "hibp":
        case "minlength":
        case "lowercase":
        case "uppercase":
        case "digits":
        case "symbols":
        case "maxage":
        case "noreuse":
        case "require2fa":
        case "externallogin":
          retval.push({ check: parts[0], value, duration });
          break;
        default:
          throw new Error(`No such password check '${parts[0]}'`);
      }
    } catch (e) {
      if (options.strict)
        throw e;
      continue;
    }
  }

  // Return in fixed order
  return retval.sort((a, b) => {
    const order = ["hibp", "minlength", "lowercase", "uppercase", "digits", "symbols", "maxage", "noreuse", "require2fa"];
    return order.indexOf(a.check) - order.indexOf(b.check);
  });
}

/** Checks if a password complies with password checks
    @param checks - String with password checks (eg "minlength:12 lowercase:8")
    @param newpassword - (New) password to check
    @param options -
      authenticationsettings Current authentication settings, for checking re-use. Omit to
      disable check for re-use.
      isCurrentPassword - checking current password
    @returns Check result
     return.success TRUE if password complies with all checks
     return.message Set when message does not comply with the checks
     return.failedchecks List of checks that failed. See [this](#ParsePasswordChecks.return.check) for the values.
*/
export async function checkPasswordCompliance(checks: string, newpassword: string, options?: { authenticationSettings?: AuthenticationSettings; isCurrentPassword?: boolean; lang?: string }): Promise<PasswordCheckResult> {
  const authenticationSettings = options?.authenticationSettings || new AuthenticationSettings;
  const failed = [];
  for (const check of parsePasswordChecks(checks, { strict: true })) {
    switch (check.check) {
      case "hibp": {
        const breachcount = await getPasswordBreachCount(newpassword);
        if (breachcount > 0) //may return -1 on HIBP connectivity error. best to let it pass and check it next time then
          failed.push(check);
        break;
      }
      case "minlength":
        if (newpassword.length < check.value)
          failed.push(check);
        break;
      case "lowercase":
        if (newpassword.replace(/[^a-z]/g, "").length < check.value)
          failed.push(check);
        break;
      case "uppercase":
        if (newpassword.replace(/[^A-Z]/g, "").length < check.value)
          failed.push(check);
        break;
      case "digits":
        if (newpassword.replace(/[^0-9]/g, "").length < check.value)
          failed.push(check);
        break;
      case "symbols":
        if (newpassword.replace(/[0-9a-zA-Z]/g, "").length < check.value)
          failed.push(check);
        break;
      case "noreuse":
        if (authenticationSettings && !options?.isCurrentPassword) {
          const cutoff = getPasswordMinValidFrom(check.duration);
          if (await authenticationSettings.isUsedSince(newpassword, cutoff)) {
            failed.push(check);
            break;
          }
        }
        break;
      case "maxage":
        if (authenticationSettings && options?.isCurrentPassword && !checkMaxAge(authenticationSettings, check.duration))
          failed.push(check);
        break;
      case "require2fa":
        if (options?.isCurrentPassword && !authenticationSettings?.hasTOTP())
          failed.push(check);
        break;
      case "externallogin": //any password fails if externallogin is enabled..
        failed.push(check);
        break;
      default:
        throw new Error(`No such password check '${check.check satisfies never}'`);
    }
  }

  if (failed.length > 0) {
    let message = '';
    if (failed.some((check) => check.check !== "hibp")) {
      const lines = [];
      for (const check of failed) {
        lines.push(`- ${getRequirementTid(check, { lang: options?.lang })}`);
      }
      message = getTid("wrd:site.forms.authpages.passwordcheck.failure", [lines.join("\n")], { langCode: options?.lang });
    } else {
      message = getTid("wrd:site.forms.authpages.passwordcheck.foundinhibp", { langCode: options?.lang });
    }

    return {
      success: false,
      message,
      failedChecks: failed.map((check) => check.check),
      badPasswordTime: authenticationSettings?.getLastPasswordChange() ?? null
    };
  }

  return {
    success: true
  };
}

/** Queries the haveibeenpwned (HIBP) service for the breach count of a password
    @param pwd - Password to query
    @returns Cacheable record
    return.value Breach count
    return.ttl Cache ttl
*/
async function getCacheablePwnCount(pwd: string) {
  const pwdhash = crypto.createHash("sha1").update(pwd).digest("hex").toUpperCase();

  try {
    const fetchres = await fetch(`https://api.pwnedpasswords.com/range/${pwdhash.substring(0, 5)}`);
    const data = await fetchres.text();
    const hashpos = data.indexOf(pwdhash.substring(5));
    if (hashpos === -1)
      return { value: 0 };

    const countstart = hashpos + 36; //35 remaining chars plus :
    const countend = data.indexOf('\n', countstart);
    return { value: parseInt(data.substring(countstart, countend), 10) };
  } catch {
    return { value: -1 };
  }
}

/** Queries the haveibeenpwned (HIBP) service for the breach count of a password
    @param pwd - Password to query
    @returns Breach count (cached for up to 30 minutes)
*/
export async function getPasswordBreachCount(pwd: string) {
  //FIXME caching
  return (await getCacheablePwnCount(pwd)).value;
}

export function getPasswordMinValidFrom(duration: string, options?: { now?: Temporal.Instant }): Temporal.Instant {
  const now = options?.now || Temporal.Now.instant();
  return subtractDuration(now, duration);
}

function checkMaxAge(authenticationsettings: AuthenticationSettings, duration: string) {
  const lastchange = authenticationsettings.getLastPasswordChange();
  const cutoff = getPasswordMinValidFrom(duration);
  return lastchange && lastchange.epochMilliseconds >= cutoff.epochMilliseconds;
}

/** Checks if authentication settings comply with password checks
    @param checks - String with password checks (eg "minlength:12 lowercase:8")
    @param authenticationsettings - Current authentication settings
    @returns Check result
     return.success TRUE if password complies with all checks
     return.message Set when message does not comply with the checks
     return.failedchecks List of checks that failed. See [this](#ParsePasswordChecks.return.check) for the values.
*/
export function checkAuthenticationSettings(checks: string, authenticationsettings?: AuthenticationSettings) {
  authenticationsettings ||= new AuthenticationSettings;
  const failed = [];
  for (const check of parsePasswordChecks(checks, { strict: true })) {
    switch (check.check) {
      case "maxage": {
        if (!checkMaxAge(authenticationsettings, check.duration))
          failed.push(check);
        break;
      }

      case "require2fa": {
        if (!authenticationsettings.hasTOTP())
          failed.push(check);
        break;
      }
    }
  }

  if (failed.length) {
    const lines = [];
    for (const check of failed) {
      lines.push(`- ${getRequirementTid(check)}`);
    }
    const message = getTid("wrd:site.forms.authpages.passwordcheck.settingsfailure", lines.join("\n"));
    return {
      success: false,
      message,
      failedchecks: failed.map((check) => check.check)
    };
  }
  return {
    success: true,
    message: "",
    failedchecks: []
  };
}

function getRequirementTid(check: { check: string; value: number; duration: string }, options?: { lang?: string }) {
  switch (check.check) {
    case "hibp":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.hibp");
    case "minlength":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.minlength", [check.value], { langCode: options?.lang });
    case "lowercase":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.lowercase", [check.value], { langCode: options?.lang });
    case "uppercase":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.uppercase", [check.value], { langCode: options?.lang });
    case "digits":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.digits", [check.value], { langCode: options?.lang });
    case "symbols":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.symbols", [check.value], { langCode: options?.lang });
    case "maxage":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.maxage", [getDurationTitle(check.duration)], { langCode: options?.lang });
    case "noreuse":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.noreuse", [getDurationTitle(check.duration)], { langCode: options?.lang });
    case "require2fa":
      return getTid("wrd:site.forms.authpages.passwordcheck.requirements.require2fa");
  }

  throw new Error(`No tids for check ${check.check}`);
}

/** Get a text describing a duration.
    @param duration - ISO 8601 duration
    @returns Duration string
*/
function getDurationTitle(duration: string): string {
  const parts = [];
  for (const [key, value] of Object.entries(parseDuration(duration))) {
    if (value === 0)
      continue;
    switch (key) {
      case "years": parts.push(getTid("wrd:site.forms.authpages.passwordcheck.duration.years", value)); break;
      case "months": parts.push(getTid("wrd:site.forms.authpages.passwordcheck.duration.months", value)); break;
      case "weeks": parts.push(getTid("wrd:site.forms.authpages.passwordcheck.duration.weeks", value)); break;
      case "days": parts.push(getTid("wrd:site.forms.authpages.passwordcheck.duration.days", value)); break;
      default: break; // ignore for now.
    }
  }

  switch (parts.length) {
    case 1:
      return getTid("wrd:site.forms.authpages.passwordcheck.duration.parts1", parts[0]);
    case 2:
      return getTid("wrd:site.forms.authpages.passwordcheck.duration.parts2", parts[0], parts[1]);
    case 3:
      return getTid("wrd:site.forms.authpages.passwordcheck.duration.parts3", parts[0], parts[1], parts[2]);
    default:
      return getTid("wrd:site.forms.authpages.passwordcheck.duration.parts4", parts[0], parts[1], parts[2], parts[3]);
  }
}

export function describePasswordChecks(checks: string, options?: { lang?: string }): string {
  const parsedchecks = parsePasswordChecks(checks, { strict: true });
  if (!parsedchecks.length)
    return "";

  const lines = [];
  for (const check of parsedchecks) {
    lines.push(`- ${getRequirementTid(check, { lang: options?.lang })}`);
  }
  return getTid("wrd:site.forms.authpages.passwordcheck.requirements", [lines.join("\n")], { langCode: options?.lang });
}

export async function verifyPasswordCompliance<T extends SchemaTypeDefinition>(wrdschema: WRDSchema<T>, userId: number, unit: number | null, password: string, authsettings: AuthenticationSettings, returnTo: string, authAuditContext: AuthAuditContext) {
  /* Verify the user is sufficiently secure, ie HIBP and complexity/age requirements, 2FA requirements
      If not, the user should go through a forced password change but we'll pass him a 'signin' token
      that will be valid to complete signin
   */
  const passwordValidationChecks = await getUserValidationSettings(wrdschema, unit);
  if (!passwordValidationChecks)
    return null;

  const passwordCheck = await checkPasswordCompliance(passwordValidationChecks, password, {
    isCurrentPassword: true,
    authenticationSettings: authsettings
  });

  if (passwordCheck.success)
    return null;

  await runInWork(() => writeAuthAuditEvent(wrdschema, {
    type: "platform:insufficient-security",
    entity: userId,
    ...authAuditContext,
    data: { failedChecks: passwordCheck.failedChecks, badPasswordTime: passwordCheck.badPasswordTime }
  }));

  //Go to complete account
  const session = await runInWork(() => createServerSession(
    "platform:incomplete-account", {
    failedchecks: passwordCheck.failedChecks,
    returnTo: returnTo || '',
    user: userId,
    badPasswordTime: passwordCheck.badPasswordTime,
  }, { expires: 3600_0000 })); //we'll give the user 1 hour to complete the account setup

  return session;
}
