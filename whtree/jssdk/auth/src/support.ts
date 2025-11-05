import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import type { WRDSchema } from "@webhare/wrd";
import type { WRDAuthSettings } from "./identity";
import { db } from "@webhare/whdb";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import { getIdCookieName } from "@webhare/auth/src/authfrontend";
import type { ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import type { System_UsermgmtSchemaType } from "@mod-platform/generated/wrd/webhare";

//TODO Export from @webhare/auth? but camelcase first
export type WRDAuthLoginSettings = {
  /** Expire normal login after this time (milliseconds) */
  expireLogin: number;
  /** Expire persistent login after this time (milliseconds) */
  expirePersistentLogin: number;
  /** Expire third party login after this time (milliseconds) */
  expireThirdPartyLogin: number;
  /** Round long logins to this time of the day (milliseconds) */
  roundLongLoginsTo: number;
  /** Round long logins in this timezone */
  roundLongLoginsTZ: string;
  /** Minimum duration of sessions when rounding (milliseconds) */
  roundMinDuration: number;
};

export const defaultWRDAuthLoginSettings: WRDAuthLoginSettings = {
  expireLogin: 86400 * 1000, // 1 day
  expirePersistentLogin: 30 * 86400 * 1000, //30 days
  expireThirdPartyLogin: 86400 * 1000, // 1 day
  roundLongLoginsTo: 4 * 3600 * 1000, // 4 am (set to -1 to disable rounding)
  roundLongLoginsTZ: "Europe/Amsterdam", // default timezone for rounding
  roundMinDuration: 3 * 3600 * 1000, // sessions last at least 3 hours
};

export type PrepAuthResult = {
  error: string;
} | {
  cookies: {
    idCookie: string;
    ignoreCookies: string[];
    secure: boolean;
    cookieSettings: ServersideCookieOptions;
    cookieName: string;
  };
  settings: WRDAuthPluginSettings & {
    wrdSchema: string;
  };
};

//We're making this entrypoint explicit to find dangerous paths later (eg these do not consider clientwebserver id which might make URL interpretation complex?)
export async function prepAuthForURL(url: string, cookieName: string | null) {
  const applytester = await getApplyTesterForURL(url);
  if (!applytester)
    throw new Error(`No applytester found for URL ${url}`);

  const settings = await applytester?.getWRDAuth();
  if (!settings?.wrdSchema)
    return { error: "No WRD schema defined for URL " + url };

  return prepAuth({ ...settings, reportedCookieName: cookieName, secureRequest: url.startsWith("https:") });
}

export type WRDAuthPluginSettings_Request = WRDAuthPluginSettings & {
  secureRequest: boolean;
  reportedCookieName: string | null;
};

//TODO Maybe we shouldn't event accept url-as-string at all
export function prepAuth(settings: WRDAuthPluginSettings_Request): PrepAuthResult {
  if (!settings?.wrdSchema)
    return { error: "No WRD schema defined" };
  if (settings.supportObjectName && !settings.customizer)
    return { error: "supportobjectname= is set but customizer= is not. This may imply critical login restrictions/data have not been ported for WH 5.8" };
  if (!settings?.wrdSchema)
    return { error: "Unable to find id token cookie/wrdauth settings" };

  if (settings.reportedCookieName && settings.reportedCookieName !== settings.cookieName)
    return { error: `WRDAUTH: login offered a different cookie name than expected: ${settings.reportedCookieName} instead of ${settings.cookieName}` };

  //FIXME webdesignplugin.whlib rewrites the cookiename if the server is not hosted in port 80/443, our authcode should do so too ?
  const { idCookie, ignoreCookies } = getIdCookieName(settings, settings.secureRequest);

  const cookieSettings: ServersideCookieOptions = {
    httpOnly: true, //XSS protection
    secure: settings.secureRequest, //mirror secure if the request was
    path: "/", //we don't support limiting WRD cookies to subpaths as various helper pages are at /.wh/
    sameSite: settings.sameSite,
  };

  return {
    cookies: {
      idCookie,
      ignoreCookies,
      secure: settings.secureRequest,
      cookieSettings,
      cookieName: settings.cookieName,
    },
    settings: settings as WRDAuthPluginSettings & { wrdSchema: string }, //as we verified this to be not-null
  };
}

export async function getUserValidationSettings<T extends SchemaTypeDefinition>(wrdschema: WRDSchema<T>, unit: number | null): Promise<string> {
  const s = wrdschema as unknown as WRDSchema<System_UsermgmtSchemaType>;

  if (unit) {
    let maxDepth = 16;
    while (unit && --maxDepth > 0) {
      const unitInfo = await s.getFields("whuserUnit", unit, ["wrdLeftEntity", "overridePasswordchecks", "passwordchecks"]);
      if (unitInfo.overridePasswordchecks) {
        return unitInfo.passwordchecks;
      }
      unit = unitInfo.wrdLeftEntity as number | null; //the 'as' resolves the ambiguity TS sees in the loop
    }
  }
  return (await getSchemaSettings(s, ["passwordValidationChecks"])).passwordValidationChecks;
}

export async function getAuthSettings<T extends SchemaTypeDefinition>(wrdschema: WRDSchema<T>): Promise<WRDAuthSettings | null> {
  const settings = await db<PlatformDB>().selectFrom("wrd.schemas").select(["accounttype", "accountemail", "accountlogin", "accountpassword"]).where("name", "=", wrdschema.tag).executeTakeFirst();
  if (!settings)
    throw new Error(`No such WRD schema '${wrdschema.tag}'`);

  if (!settings.accounttype)
    return null;

  const type = await db<PlatformDB>().selectFrom("wrd.types").select(["tag"]).where("id", "=", settings.accounttype).executeTakeFirstOrThrow();
  const accountType = tagToJS(type.tag);
  const persontype = wrdschema.getType(accountType);
  const attrs = await persontype.listAttributes();

  const email = attrs.find(_ => _.id === settings.accountemail);
  const login = attrs.find(_ => _.id === settings.accountlogin);
  const password = attrs.find(_ => _.id === settings.accountpassword);

  return {
    accountType,
    emailAttribute: email?.tag ?? null,
    loginAttribute: login?.tag ?? null,
    loginIsEmail: Boolean(email?.id && email?.id === login?.id),
    passwordAttribute: password?.tag ?? null,
    passwordIsAuthSettings: password?.attributeType === "authenticationSettings",
    hasAccountStatus: attrs.some(_ => _.tag === "wrdauthAccountStatus"),
    hasWhuserUnit: attrs.some(_ => _.tag === "whuserUnit")
  };
}

export function calculateWRDSessionExpiry(loginSettings: WRDAuthLoginSettings, now: Temporal.Instant, expiryTime: number): Temporal.Instant {
  if (!(expiryTime > 0))
    throw new Error(`Invalid expiry time configured`);

  //First we add the requested expiryTime to the base time
  const expiry = now.add({ milliseconds: expiryTime });
  if (!(loginSettings.roundLongLoginsTo >= 0))
    return expiry;

  /* Rounding is enabled - this is the default!

     If adding expiryTime changes the date, we generally round down to the 'PlainTime' expressed by round_longlogins_to
     so we don't suddenly abort your session X days later at exactly 24 hours of your last login. We try to end a session during
     your likely down time (at 'night') but we have a minimum time to help you in case you log in just before the rounding time
     (because if you login during the minimum time window... you're either on a night owl hacking session or fixing something
     that's broken and we don't want to kick you out at 4am after grumpily logging in at 3:30am.

     This does mean that a session can actually last *longer* than the expiry time as we would now round *up* towards the login time
     one day later */
  const toRound = expiry.add({ milliseconds: loginSettings.roundMinDuration });
  const localizedToRound = toRound.toZonedDateTimeISO(loginSettings.roundLongLoginsTZ);
  const wasNextDay = (localizedToRound.epochMilliseconds - localizedToRound.startOfDay().epochMilliseconds) < loginSettings.roundLongLoginsTo;

  const nightlyTarget = localizedToRound.startOfDay().subtract({ days: wasNextDay ? 1 : 0 }).add({ milliseconds: loginSettings.roundLongLoginsTo });

  return nightlyTarget.epochMilliseconds > now.epochMilliseconds ? nightlyTarget.toInstant() : expiry;
}

export function getAuthPageURL(url: string, vars?: Record<string, string>): URL {
  const parsed = new URL(url);
  const authPage = new URL(parsed.origin + "/.wh/common/authpages/");
  if (parsed.pathname !== '/')
    authPage.searchParams.set("pathname", parsed.pathname.substring(1));
  if (vars)
    for (const [key, value] of Object.entries(vars))
      authPage.searchParams.set(key, value);
  return authPage;
}
