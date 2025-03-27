/* We will be used by 'wh' in spots where config may not exist so we can't rely on the config/platform.json file (or on @webhare/services)

*/

import { generateNoDBConfig } from "@mod-system/js/internal/generation/gen_config_nodb";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";

const config = generateNoDBConfig();
const modules = Object.keys(config.public.module).sort();
const builtinmodules = modules.filter(mod => whconstant_builtinmodules.includes(mod));
process.stdout.write(`export WEBHARE_CFG_MODULES="${modules.join(" ")}"\n`);
process.stdout.write(`export WEBHARE_CFG_INSTALLEDMODULES="${builtinmodules.join(" ")}"\n`);

for (const name of modules) {
  process.stdout.write(`export WEBHARE_CFG_MODULEDIR_${name.replaceAll("-", "__dash__")}="${config.public.module[name].root}"\n`);
}
