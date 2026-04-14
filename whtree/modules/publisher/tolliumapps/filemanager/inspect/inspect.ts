import { exportWHSFObject } from "@mod-platform/openapi/api/whfs";
import { exportFileAsFetch } from "@webhare/services";
import { openFileOrFolder } from "@webhare/whfs";
import YAML from 'yaml';

export async function inspectObject(id: number) {
  const obj = await openFileOrFolder(id, { allowHistoric: true, allowMissing: true });
  const exp = obj ? await exportWHSFObject(obj!, "*", { export: true, exportFile: exportFileAsFetch }) : null;
  return { yaml: YAML.stringify(exp) };
}
