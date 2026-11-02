import type { FSObjectPolicy, FSObjectPolicyBaseContext } from "@webhare/backend-integration";

export const seoPolicy: FSObjectPolicy = {
  getFallbackMetaTitle: (context: FSObjectPolicyBaseContext) => {
    if (context.title === "default")
      return null;

    const suffix = ` - ${context.targetParent},${context.targetObject},${context.contentObject}`;
    return (context.title ? context.title + " - Home" : "Initial placeholder title") + suffix;
  }
};
