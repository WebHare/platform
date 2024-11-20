import type { SchemaObject, ValidateFunction } from "ajv";
import type Ajv from "ajv";
import type Ajv2019 from "ajv/dist/2019";
import type Ajv2020 from "ajv/dist/2020";

let ajvDraft: (Ajv | null) = null;
let ajv2019: (Ajv2019 | null) = null;
let ajv2020: (Ajv2020 | null) = null;

export type { SchemaObject as JSONSchemaObject, ValidateFunction as AjvValidateFunction };
export type AnyAjv = Ajv | Ajv2019 | Ajv2020;

export async function getAjvForSchema(schema: SchemaObject) {
  const addFormats = (await import("ajv-formats")).default;

  if ([
    "http://json-schema.org/draft-04/schema#",
    "http://json-schema.org/draft-06/schema#",
    "http://json-schema.org/draft-07/schema#",
  ].includes(schema.$schema ?? "")) {
    if (!ajvDraft) {
      const AjvLib = await import("ajv");
      ajvDraft = new AjvLib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
      addFormats(ajvDraft);
    }
    return ajvDraft;
  }

  if (schema.$schema === "https://json-schema.org/draft/2019-09/schema") {
    if (!ajv2019) {
      const Ajv2019Lib = await import("ajv/dist/2019.js");
      ajv2019 = new Ajv2019Lib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
      addFormats(ajv2019);
    }
    return ajv2019;
  }

  if (!ajv2020) {
    const Ajv2020Lib = await import("ajv/dist/2020.js");
    ajv2020 = new Ajv2020Lib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
    addFormats(ajv2020);
  }

  return ajv2020;
}

export async function getCompiledJSONSchema(schema: SchemaObject): Promise<ValidateFunction> {
  const myAjv = await getAjvForSchema(schema);
  return await myAjv.compile(schema);
}
