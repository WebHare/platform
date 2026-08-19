import { exportWHSFObject } from "@mod-platform/openapi/api/whfs";
import { exportFileAsFetch } from "@webhare/services";
import { openFileOrFolder } from "@webhare/whfs";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import YAML from 'yaml';

export async function inspectObject(id: number) {
  try {
    const obj = await openFileOrFolder(id, { allowHistoric: true, allowMissing: true });
    const exp = obj ? await exportWHSFObject(obj!, "*", { export: true, exportFile: exportFileAsFetch }) : null;
    const result = {
      yaml: YAML.stringify(exp),
      onRenderContent: ""
    };

    if (obj) {
      const applyTester = await getApplyTesterForObject(obj);
      const rendering = await applyTester.getObjRenderInfo();

      if (rendering.onRenderContent)
        result.onRenderContent = rendering.onRenderContent;
      else if (rendering.hsPageObjectType)
        result.onRenderContent = rendering.hsPageObjectType + (rendering.dynamicExecution ? " (dynamic)" : " (static)");
      else if (rendering.dynamicExecution?.routerfunction)
        result.onRenderContent = rendering.dynamicExecution.routerfunction + " (router)";
    }

    return result;
  } catch (err) {
    return { error: (err as Error).message };
  }
}
