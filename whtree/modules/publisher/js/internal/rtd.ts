import { exportAsHareScriptRTD } from "@webhare/hscompat";
import { buildRTD } from "@webhare/services";
import YAML from "yaml";

export async function buildRTDFromYAML(yaml: string) {
  return exportAsHareScriptRTD(await buildRTD(YAML.parse(yaml, { version: '1.2', strict: true })));
}
