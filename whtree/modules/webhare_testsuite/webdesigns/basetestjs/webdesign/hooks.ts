import type { FSObjectPolicy, FSObjectPolicyBaseContext } from "@webhare/backend-integration";
import { openFile } from "@webhare/whfs";

export const schedulingDefaultsPolicy: FSObjectPolicy = {
  getPublicationDefaults: async (context: FSObjectPolicyBaseContext) => {
    const target = await openFile(context.fsObject, { allowHistoric: true });

    if (target.title.match(/^\d{4}-\d{2}-\d{2}/)) {
      return {
        start: Temporal.Instant.from(target.title),
        end: Temporal.Instant.from(target.title).add({ hours: 36 })
      };
    }

    return null;
  }
};
