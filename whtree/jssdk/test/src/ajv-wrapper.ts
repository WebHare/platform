//Node requires the JSON import attribute, but our tsconfig's commonjs module setting doesn't allow it (TS2823)
// @ts-expect-error -- see above
import draft06MetaSchema from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import type { SchemaObject, ValidateFunction } from "ajv";
import type Ajv from "ajv";
import type Ajv2019 from "ajv/dist/2019";
import type Ajv2020 from "ajv/dist/2020";

let ajvDraft: (Ajv | null) = null;
let ajv2019: (Ajv2019 | null) = null;
let ajv2020: (Ajv2020 | null) = null;

export type { SchemaObject as JSONSchemaObject, ValidateFunction as AjvValidateFunction };
export type AnyAjv = Ajv | Ajv2019 | Ajv2020;

/** JSON Schema meta-schema URLs we know which Ajv flavour to use for */
export const knownJSONSchemaMetaSchemas: readonly string[] = [
  "http://json-schema.org/draft-06/schema#",
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft/2019-09/schema",
  "https://json-schema.org/draft/2020-12/schema",
];

function addKeywords(ajv: AnyAjv) {
  ajv.addKeyword({
    keyword: "tsType",
    schemaType: "string",
  });
}

export async function getAjvForSchema(schema: SchemaObject | boolean) {
  const addFormats = (await import("ajv-formats")).default;
  const $schema = typeof schema === "object" && schema ? schema.$schema : undefined;

  if ([
    "http://json-schema.org/draft-06/schema#",
    "http://json-schema.org/draft-07/schema#",
  ].includes($schema ?? "")) {
    if (!ajvDraft) {
      const AjvLib = await import("ajv");
      ajvDraft = new AjvLib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
      //Ajv's default instance only knows draft-07, add the draft-06 meta-schema (Ajv 8 doesn't support draft-04)
      ajvDraft.addMetaSchema(draft06MetaSchema);
      addFormats(ajvDraft);
      addKeywords(ajvDraft);
    }
    return ajvDraft;
  }

  if ($schema === "https://json-schema.org/draft/2019-09/schema") {
    if (!ajv2019) {
      const Ajv2019Lib = await import("ajv/dist/2019.js");
      ajv2019 = new Ajv2019Lib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
      addFormats(ajv2019);
      addKeywords(ajv2019);
    }
    return ajv2019;
  }

  if (!ajv2020) {
    const Ajv2020Lib = await import("ajv/dist/2020.js");
    ajv2020 = new Ajv2020Lib.default({ allErrors: true, allowMatchingProperties: true, strict: true });
    addFormats(ajv2020);
    addKeywords(ajv2020);
  }

  return ajv2020;
}

export async function getCompiledJSONSchema(schema: SchemaObject): Promise<ValidateFunction> {
  const myAjv = await getAjvForSchema(schema);
  return await myAjv.compile(schema);
}
