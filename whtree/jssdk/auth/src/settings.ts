import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db } from "@webhare/whdb";
import type { WRDSchemaType } from "@webhare/wrd";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import type { WRDAuthSettings } from "./identity";

export async function getAuthSettings<T extends SchemaTypeDefinition>(wrdschema: WRDSchemaType<T>): Promise<WRDAuthSettings | null> {
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
