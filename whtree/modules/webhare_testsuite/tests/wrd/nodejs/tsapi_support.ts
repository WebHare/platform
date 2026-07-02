import { beginWork, commitWork } from "@webhare/whdb";
import { wrd, type AnySchemaType } from "@webhare/wrd";

export async function testExportImport(tag: string, entityId: number, viaExport = false): Promise<number> {
  const schema = wrd<AnySchemaType>(tag);

  const attrs = await schema.getType("testImexport").listAttributes();
  const getFields = attrs.filter(a => a.tag.startsWith("test")).map(a => a.tag);

  const data = await schema.getFields("testImexport", entityId, getFields, { export: viaExport });
  if (!data)
    throw new Error(`Failed to get fields for entity ${entityId} of type testImexport`);

  const filtered = Object.fromEntries(Object.entries(data).filter(([k, v]) => k.startsWith("test")));

  await beginWork();
  const newId = await schema.insert("testImexport", filtered);
  await commitWork();

  return newId;
}
