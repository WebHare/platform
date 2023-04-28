import { runAccountExpiration } from "@mod-system/js/internal/userrights/accountexpiration";
import { listSchemas } from "@webhare/wrd";

async function expireOldUsers() {
  let schemastofix = await listSchemas();
  schemastofix = schemastofix.filter(_ => _.usermgmt);
  for (const schema of schemastofix) {
    await runAccountExpiration(schema.tag);
  }
}
expireOldUsers();
