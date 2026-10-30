import { importJSObject } from "@webhare/services";
import { openFileOrFolder } from "@webhare/whfs";
import type { FSObjectPolicy, FSObjectPolicyBaseContext, PublicationDefaults } from "@webhare/backend-integration";
import { getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";

type HSPolicyContext = {
  target: number;
  targetparent: number;
  content: number;
  title: string;
};

export type PolicyMap = { [Key in keyof FSObjectPolicy]?: string[] };

async function findObjectPolicyWithHandler<Handler extends keyof FSObjectPolicy>(id: number, handler: Handler): Promise<(FSObjectPolicy & Required<Pick<FSObjectPolicy, Handler>>) | null> {
  const applytester = await getApplyTesterForObject(await openFileOrFolder(id, { allowHistoric: true }));
  const fsObjectPolicyRules = await applytester["getMatchingRules"]("fsobjectpolicy");
  for (const rule of fsObjectPolicyRules?.reverse() ?? []) {
    const fsObjectPolicy = rule.fsobjectpolicy;
    if (fsObjectPolicy) {
      //importJSObject should sufficiently cache/reuse by itself
      const policy = await importJSObject<FSObjectPolicy>(fsObjectPolicy);
      if (policy[handler]) {
        return policy as FSObjectPolicy & Required<Pick<FSObjectPolicy, Handler>>;
      }
    }
  }
  return null;
}

/** List which policy objects actually affect a policy for an object */
export async function getPoliciesForObject(applytester: WHFSApplyTester, policies: (keyof FSObjectPolicy)[]): Promise<PolicyMap> {
  const fsObjectPolicyRules = await applytester["getMatchingRules"]("fsobjectpolicy");

  const policymap: PolicyMap = {};
  for (const rule of fsObjectPolicyRules) {
    const fsObjectPolicy = rule.fsobjectpolicy;
    if (fsObjectPolicy) {
      const policy = await importJSObject<FSObjectPolicy>(fsObjectPolicy);
      for (const policyKey of policies) {
        if (policy[policyKey]) {
          policymap[policyKey] ||= [];
          policymap[policyKey].push(fsObjectPolicy);
        }
      }
    }
  }
  return policymap;
}

function mapHSContext(inContext: HSPolicyContext): FSObjectPolicyBaseContext {
  return {
    targetObject: inContext.target || null,
    targetParent: inContext.targetparent,
    contentObject: inContext.content || null,
    title: inContext.title
  };
}

export async function getPublicationDefaults(context: HSPolicyContext): Promise<PublicationDefaults | null> {
  const policy = await findObjectPolicyWithHandler(context.target, "getPublicationDefaults");
  if (policy)
    return await policy.getPublicationDefaults(mapHSContext(context));
  return null;
}

export async function getFallbackMetaTitle(context: HSPolicyContext, policies: PolicyMap): Promise<string | null> {
  const policyName = (policies.getFallbackMetaTitle ?? []).at(-1);
  if (policyName) {
    const obj = await importJSObject<FSObjectPolicy>(policyName);
    if (obj?.getFallbackMetaTitle) //still there?
      return await obj.getFallbackMetaTitle(mapHSContext(context));
  }
  return null;
}
