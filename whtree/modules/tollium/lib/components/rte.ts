import { TrackedYAML, type ValidationMessageWithType } from "@mod-platform/js/devsupport/validation";
import { YAML } from "@webhare/deps";
import { buildRTDFromHareScriptRTD, exportAsHareScriptRTD, type HareScriptRTD } from "@webhare/hscompat";
import { buildRTD, exportFileAsFetch } from "@webhare/services";

export async function convertRTDValueToYaml(value: HareScriptRTD): Promise<string> {
  const rtd = await buildRTDFromHareScriptRTD(value);
  return YAML.stringify(await rtd.export({ exportFile: exportFileAsFetch }));
}

export async function validateRTDYaml(newText: string): Promise<ValidationMessageWithType[]> {
  const tracked = new TrackedYAML<object>(newText);
  return tracked.getMessages("mod::nosuchmodule/rtd.yml");
}

export async function convertYamlToRTDValue(newText: string): Promise<HareScriptRTD> {
  const doc = await buildRTD(YAML.parse(newText));
  return await exportAsHareScriptRTD(doc);
}
