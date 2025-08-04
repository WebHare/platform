import { HTTPSuccessCode, type RestAuthorizationResult, type WebResponse, type RestAuthorizationFunction, type RestRequest } from "@webhare/router";
import type { TypedRestRequest } from "modules/platform/generated/openapi/platform/api";

import { WRDSchema } from "@webhare/wrd";
import { failWRDAPIUserAuth, verifyWRDAPIUser, type AuthorizedWRDAPIUser } from "@webhare/openapi-service";
import { loadlib } from "@webhare/harescript";

export async function verifyUser(req: RestRequest): Promise<RestAuthorizationResult<AuthorizedWRDAPIUser>> {
  const basecheck = await verifyWRDAPIUser(req);
  if (!basecheck.authorized)
    return basecheck;

  //Check whether this user is allowed to access the API
  const wrdschemaObj = await loadlib("mod::wrd/lib/api.whlib").OpenWRDschema(basecheck.authorization.wrdSchema);
  if (!wrdschemaObj)
    return failWRDAPIUserAuth(`WRD Schema not found`);

  const userapi = await loadlib("mod::wrd/lib/internal/userapi.whlib").GetWRDAuthUserAPI(wrdschemaObj);
  const userobj = await userapi.GetUser(basecheck.authorization.userId);
  if (!userobj)
    return failWRDAPIUserAuth(`User not found`);

  if (!(await userobj.hasRight("platform:api")))
    return failWRDAPIUserAuth(`User is not authorized to access the WebHare API`);

  if (!(await userobj.hasRight("system:sysop"))) //TODO APIs themselves SHOULD check whatever you're trying to do by testing against an intersection of your rights and scopes, but for now juist require syosop rights and tokesn
    return failWRDAPIUserAuth(`User does not have the privileges to share what is currently scoped`);
  if (!basecheck.authorization.scopes.includes("system:sysop"))
    return failWRDAPIUserAuth(`User lacks required scope`);

  return basecheck;
}

export async function getMeta(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /meta">): Promise<WebResponse> {
  const wrdschema = new WRDSchema(req.authorization.wrdSchema);
  //TODO get the proper type and email/auth info from the wrdschema settings
  const user = await wrdschema.getFields("wrdPerson", req.authorization.userId, ["wrdContactEmail", "wrdGuid"]);
  return req.createJSONResponse(HTTPSuccessCode.Ok, {
    user: {
      guid: user.wrdGuid,
      email: user.wrdContactEmail
    }
  });
}


//validate signatures
verifyUser satisfies RestAuthorizationFunction;
