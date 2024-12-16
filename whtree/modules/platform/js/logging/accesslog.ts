import { type ModDefYML } from "@webhare/services/src/moduledefparser";

type PxlEventConfig = Record<string, {
  fields: Record<string, "string" | "number" | "boolean">;
}>;
type FieldTypes = Map<string, string>;

function getFields(modYml: ModDefYML, event: string, includePath: string[], fieldTypes: FieldTypes): Record<string, "string" | "number" | "boolean"> {
  const eventInfo = modYml.pxlEvents?.[event];
  if (!eventInfo)
    throw new Error(`Unknown event '${eventInfo}'`);

  const fields = { ...eventInfo.fields };
  for (const [key, type] of Object.entries(fields)) {
    if (fieldTypes.has(key)) {
      if (fieldTypes.get(key) !== type)
        throw new Error(`pxlEvent field '${key}' is declared as both a '${fieldTypes.get(key)}' and a '${type}' in this module`);
    } else {
      fieldTypes.set(key, type);
    }
  }

  if (eventInfo.includeFields) {
    if (includePath.includes(eventInfo.includeFields))
      throw new Error(`Circular includeFields ${includePath.join(" -> ")} -> ${eventInfo.includeFields}`);

    includePath.push(eventInfo.includeFields);

    const includedFields = getFields(modYml, eventInfo.includeFields, includePath, fieldTypes);
    Object.assign(fields, includedFields);
  }

  return fields;
}

export function getYMLPxlConfigs(modYml: ModDefYML): PxlEventConfig {
  const configs: PxlEventConfig = {};
  const fieldTypes: FieldTypes = new Map;

  for (const [key] of Object.entries(modYml.pxlEvents || {})) {
    try {
      const fields = getFields(modYml, key, [], fieldTypes);
      configs[`${modYml.module}:${key}`] = { fields };
    } catch (e) {
      throw new Error(`Error while processing pxlEvent '${modYml.module}:${key}': ${(e as Error).message}`, { cause: e });
    }
  }
  return configs;
}
