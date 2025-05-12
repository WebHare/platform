import type { System_UsermgmtSchemaType } from "@mod-platform/generated/wrd/webhare";
import type { WRDAuthAccountStatus } from "@webhare/auth";
import { isTemporalInstant, throwError } from "@webhare/std";
import * as test from "@webhare/test";
import { describeEntity, WRDSchema } from "@webhare/wrd";

export async function getAccountStatus(personId: number): Promise<WRDAuthAccountStatus> {
  const descr = await describeEntity(personId) ?? throwError("Failed to find entity #" + personId);
  const schema = new WRDSchema<System_UsermgmtSchemaType>(descr?.schema);
  const { wrdauthAccountStatus } = await schema.getFields("wrdPerson", personId, ["wrdauthAccountStatus"]);
  test.assert(isTemporalInstant(wrdauthAccountStatus.since), "wrdauthAccountStatus.since is not a Temporal.Instant");
  return wrdauthAccountStatus;
}
