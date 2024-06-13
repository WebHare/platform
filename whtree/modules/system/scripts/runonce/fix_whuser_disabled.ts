import { beginWork, commitWork } from "@webhare/whdb/src/whdb";
import { WRDSchema, listSchemas } from "@webhare/wrd";

async function fixWHUserDisabled() {
  for (const schema of await listSchemas()) {
    const schemaobj = new WRDSchema(schema.tag);
    const persontype = schemaobj.getType("wrdPerson");
    if (!await persontype.exists())
      continue;

    if (!await persontype.describeAttribute("whuserDisabled"))
      continue;
    if (!await persontype.describeAttribute("whuserDisableType"))
      throw new Error(`Schema '${schema.tag}' has no whuserDisableType attribute - verify the schema is actually including usermgmt.wrdschema.xml!`);

    const fixusers = await schemaobj.query("wrdPerson").
      select(["wrdId", "whuserDisabled", "whuserDisableType"]).
      where("whuserDisabled", "=", true).
      where("whuserDisableType", "=", null).
      execute();

    if (fixusers.length) {
      await beginWork();
      for (const user of fixusers)
        await schemaobj.update("wrdPerson", user.wrdId, { whuserDisableType: "manual" });
      await commitWork();
    }
  }
}

fixWHUserDisabled();
