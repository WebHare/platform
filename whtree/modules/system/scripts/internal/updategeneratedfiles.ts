// short: Updates all generated files (eg database definitions)

import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import { updateAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { updateAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";

async function runUpdate() {
  await updateWebHareConfigFile(true);
  await updateAllModuleTableDefs();
  await updateAllModuleWRDDefs();
}

runUpdate();
