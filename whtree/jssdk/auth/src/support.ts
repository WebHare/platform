import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";
import type { WRDSchema } from "@webhare/wrd";
import type { WRDAuthSettings } from "./identity";
import { db } from "@webhare/whdb";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";

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
