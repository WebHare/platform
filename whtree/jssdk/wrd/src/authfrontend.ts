import type { WebRequest } from "@webhare/router/src/request";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";
import { WRDSchema } from "./wrd";
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { IdentityProvider } from "./auth";

/** Get the user linked to a URL */
export async function getRequestUser(req: WebRequest, pathname: string): Promise<{ wrdSchema: string; user: number } | null> {
  const info = await getApplyTesterForURL(req.getOriginURL(pathname)!);
  const wrdauth = await info.getWRDAuth();
  if (!wrdauth.wrdSchema)
    throw new Error(`WRDAuth is not configured for ${req.url}`);

  const logincookie = req.getCookie(wrdauth.cookieName);
  const idtoken = logincookie?.match(/ idToken:(.+)$/)?.[1];
  if (idtoken) {
    const wrdschema = new WRDSchema<WRD_IdpSchemaType>(wrdauth.wrdSchema);
    const provider = new IdentityProvider(wrdschema);
    const tokeninfo = await provider.verifyLoginToken(idtoken);
    if (!("error" in tokeninfo))
      return { wrdSchema: wrdauth.wrdSchema, user: tokeninfo.entity };
  }

  return null;
}
