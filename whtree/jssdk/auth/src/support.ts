import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";
import type { WRDSchema } from "@webhare/wrd";
import type { WRDAuthSettings } from "./identity";
import { db } from "@webhare/whdb";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import { getIdCookieName } from "@webhare/wrd/src/authfrontend";
import type { ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";

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

export async function prepAuth(url: string, cookieName: string | null): Promise<PrepAuthResult> {
  const applytester = await getApplyTesterForURL(url);
  //TODO if we can have siteprofiles build a reverse map of which apply rules have wrdauth rules, we may be able to cache these lookups
  const settings = await applytester?.getWRDAuth();
  if (!settings?.wrdSchema)
    return { error: "No WRD schema defined for URL " + url };
  if (!settings?.wrdSchema)
    return { error: "Unable to find id token cookie/wrdauth settings for URL " + url };

  if (cookieName && cookieName !== settings.cookieName)
    return { error: `WRDAUTH: login offered a different cookie name than expected: ${cookieName} instead of ${settings.cookieName}` };

  //FIXME webdesignplugin.whlib rewrites the cookiename if the server is not hosted in port 80/443, our authcode should do so too ?
  const { idCookie, ignoreCookies } = getIdCookieName(url, settings);
  const secure = url.startsWith("https:");

  const cookieSettings: ServersideCookieOptions = {
    httpOnly: true, //XSS protection
    secure, //mirror secure if the request was
    path: "/", //we don't support limiting WRD cookies to subpaths as various helper pages are at /.wh/
    sameSite: settings.sameSite,
  };

  return {
    cookies: {
      idCookie,
      ignoreCookies,
      secure,
      cookieSettings,
      cookieName: settings.cookieName,
    },
    settings: settings as WRDAuthPluginSettings & { wrdSchema: string }, //as we verified this to be not-null
  };
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
  const attrs = await persontype.ensureAttributes();

  const email = attrs.find(_ => _.id === settings.accountemail);
  const login = attrs.find(_ => _.id === settings.accountlogin);
  const password = attrs.find(_ => _.id === settings.accountpassword);

  return {
    accountType,
    emailAttribute: email ? tagToJS(email.tag) : null,
    loginAttribute: login ? tagToJS(login.tag) : null,
    loginIsEmail: Boolean(email?.id && email?.id === login?.id),
    passwordAttribute: password ? tagToJS(password.tag) : null,
    passwordIsAuthSettings: password?.attributetypename === "AUTHSETTINGS",
    hasAccountStatus: attrs.some(_ => _.tag === "WRDAUTH_ACCOUNT_STATUS")
  };
}
