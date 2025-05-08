import { loadJSONSchema, type JSONSchemaObject } from "@webhare/test";


export async function checkAgainstJsonSchema(schema: string | JSONSchemaObject, data: unknown) {
  return (await loadJSONSchema(schema)).validate(data);
}
