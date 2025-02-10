import { parseTyped, stringify } from "@webhare/std/strings";
import { loadJSExport } from "@webhare/services/src/resourcetools";

///stringifying for safe transport through HS
export async function testInvoke(lib: string, params: string): Promise<string> {
  const [library, func] = lib.split("#");
  const testInvokeApi = await loadJSExport<Record<string, (...args: unknown[]) => unknown>>(`${library}#testInvokeApi`);
  if (!testInvokeApi[func]) {
    throw new Error(`No such testInvokeApi '${func}' in ${library}. available: ${Object.keys(testInvokeApi).join(", ")}`);
  }

  return stringify(await testInvokeApi[func](...parseTyped(params[0]), { typed: true }));
}
