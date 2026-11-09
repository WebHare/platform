// Support for the WRD Browser 'Edit source' dialog. Mirrors `wh wrd export` / `wh wrd import`

import { wrd, describeEntity, type AnySchemaType } from "@webhare/wrd";
import { exportFileAsFetch } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import YAML from "yaml";

async function getEntityContext(entityId: number) {
  const descr = await describeEntity(entityId);
  if (!descr)
    throw new Error(`No such entity #${entityId}`);

  const schema = wrd<AnySchemaType>(descr.schema);
  const attrs = await schema.getType(descr.type).listAttributes();
  return { schema, type: descr.type, attrs };
}

/** Attributes that shouldn't be edited by accident. They're listed as a comment at the end, uncommenting them deliberately overrides the value */
const commentedAttributes = ["wrdModified"];
/** Attribute types whose values are hidden (if set) to avoid exposing secrets. Unset values are shown as null */
const hiddenAttributeTypes = ["password", "authenticationSettings"];

export async function exportEntitySource(entityId: number): Promise<{ yaml: string }> {
  const { schema, type, attrs } = await getEntityContext(entityId);
  const entity: Record<string, unknown> = await schema.getFields(type, entityId, attrs.map(_ => _.tag), {
    export: true,
    exportFile: exportFileAsFetch,
    historyMode: "unfiltered",
  });

  const comments: string[] = [];
  for (const attr of attrs) {
    if (!(attr.tag in entity))
      continue;
    if (commentedAttributes.includes(attr.tag)) {
      comments.push(`# ${attr.tag}: ${entity[attr.tag] ?? "null"}`);
      delete entity[attr.tag];
    } else if (hiddenAttributeTypes.includes(attr.attributeType) && entity[attr.tag] !== null) {
      comments.push(`# ${attr.tag}: not shown`);
      delete entity[attr.tag];
    }
  }

  return { yaml: YAML.stringify(entity) + (comments.length ? "\n" + comments.map(_ => _ + "\n").join("") : "") };
}

export async function importEntitySource(entityId: number, source: string): Promise<{ error: string }> {
  try {
    const { schema, type, attrs } = await getEntityContext(entityId);
    const importData: unknown = YAML.parse(source);
    if (!importData || typeof importData !== "object" || Array.isArray(importData))
      throw new Error("The source must be a YAML object with the entity's fields");

    const fields = importData as Record<string, unknown>;
    delete fields.wrdId;
    for (const attr of attrs)
      if (attr.isReadOnly)
        delete fields[attr.tag];

    await runInWork(() => schema.update(type, entityId, fields));
    return { error: "" };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
