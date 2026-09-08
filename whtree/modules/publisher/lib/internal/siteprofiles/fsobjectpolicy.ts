import { importJSObject } from "@webhare/services";
import { openFileOrFolder } from "@webhare/whfs";
import type { FSObjectPolicy, FSObjectPolicyBaseContext, PublicationDefaults } from "@webhare/backend-integration";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";

async function findObjectPolicyWithHandler<Handler extends keyof FSObjectPolicy>(id: number, handler: Handler): Promise<(FSObjectPolicy & Required<Pick<FSObjectPolicy, Handler>>) | null> {
  const applytester = await getApplyTesterForObject(await openFileOrFolder(id, { allowHistoric: true }));
  const fsObjectPolicyRules = await applytester["getMatchingRules"]("fsobjectpolicy");
  for (const rule of fsObjectPolicyRules?.reverse() ?? []) {
    const fsObjectPolicy = rule.fsobjectpolicy;
    if (fsObjectPolicy) {
      //TODO cache policies we already loaded? or is that already implied in importJSObject
      const policy = await importJSObject<FSObjectPolicy>(fsObjectPolicy);
      if (policy[handler]) {
        return policy as FSObjectPolicy & Required<Pick<FSObjectPolicy, Handler>>;
      }
    }
  }
  return null;
}

export async function getPublicationDefaults(id: number): Promise<PublicationDefaults | null> {
  const policy = await findObjectPolicyWithHandler(id, "getPublicationDefaults");
  if (policy)
    return await policy.getPublicationDefaults({ fsObject: id } satisfies FSObjectPolicyBaseContext);
  return null;
}
