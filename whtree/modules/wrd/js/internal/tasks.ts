import { addDuration } from "@webhare/std";
import { beginWork, db, commitWork } from "@webhare/whdb";
import { listSchemas } from "@webhare/wrd";
import { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";

export async function cleanupOutdatedEntities(options?: { forSchema?: string }) {
  await beginWork();

  const now = new Date();
  // We'll only delete entities that are modified at least one day ago
  const modifiedBefore = addDuration(now, "-P1D");

  // List all types of all schemas
  const schemas = (await listSchemas()).filter(schema => !options?.forSchema || schema.tag == options.forSchema);
  const types = await db<WebHareDB>()
    .selectFrom("wrd.types")
    .select(["id", "deleteclosedafter"])
    .where("wrd_schema", "in", schemas.map(_ => _.id))
    .where("deleteclosedafter", ">", 0)
    .execute();

  // Delete outdated entities
  for (const wrdType of types) {
    const outdatedDate = addDuration(now, `-P${wrdType.deleteclosedafter}D`);
    await db<WebHareDB>()
      .deleteFrom("wrd.entities")
      .where("type", "=", wrdType.id)
      .where("limitdate", "<", outdatedDate)
      .where("modificationdate", "<", modifiedBefore)
      .execute();
  }

  await commitWork();
}
