import { loadTSType } from "@webhare/test/src/checks";

export async function checkJSONStructure(typeref: string, json: string): Promise<string> {
  try {
    const validator = await loadTSType(typeref, { ignoreErrors: true, noExtraProps: true });
    validator.validateStructure(JSON.parse(json));
  } catch (e) {
    return (e as Error).message;
  }
  return "";

}
