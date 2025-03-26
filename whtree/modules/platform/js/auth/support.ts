import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { defaultDateTime } from "@webhare/hscompat";
import { beginWork, commitWork, db } from "@webhare/whdb";

export async function runAuthMaintenance() {
  await beginWork();
  await db<PlatformDB>().deleteFrom("wrd.tokens").where("expirationdate", ">", defaultDateTime).where("expirationdate", "<", new Date).execute();
  await commitWork();
}
