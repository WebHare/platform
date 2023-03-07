// short: Updates all generated files (eg database definitions)

import { updateAllModuleTableDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { updateAllModuleWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";

updateAllModuleTableDefs();
updateAllModuleWRDDefs();
