/* Validation of MCP tool arguments against the tool's inputSchema. MCP uses JSON Schema 2020-12 as the default dialect */

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { formatAjvErrors } from "@mod-system/js/internal/util/ajv";

let ajv: Ajv2020 | null = null;

/** Compiled validators, keyed by the JSON of their schema. A changed schema (after wh apply config) simply gets a new entry */
const validators = new Map<string, ValidateFunction>();

function getAjv(): Ajv2020 {
  if (!ajv) {
    /* Report all errors so the client's model can fix its call in one go. We don't coerce types, apply defaults or remove
       additional properties: a schema with additionalProperties: false should reject extra arguments, not silently drop them */
    ajv = new Ajv2020({ allErrors: true, allowMatchingProperties: true, addUsedSchema: false });
    addFormats(ajv);
  }
  return ajv;
}

/** Get the (cached) validator for an input schema
    @throws If the schema is invalid */
function getValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let validator = validators.get(key);
  if (!validator) {
    if (schema.$async === true)
      throw new Error("Async input schemas are not supported");
    validator = getAjv().compile(schema);
    validators.set(key, validator);
  }
  return validator;
}

/** Check whether an input schema is usable for an MCP tool
    @returns An error message, or null if the schema is valid */
export function checkInputSchema(schema: Record<string, unknown>): string | null {
  if (schema.type !== "object")
    return `The inputSchema must have type 'object'`;
  try {
    getValidator(schema);
    return null;
  } catch (e) {
    return `Invalid inputSchema: ${(e as Error).message}`;
  }
}

/** Validate tool arguments against an input schema
    @returns A description of what's wrong with the arguments, or null if they're valid
    @throws If the schema itself is invalid */
export function validateToolInput(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const validator = getValidator(schema);
  return validator(args) ? null : formatAjvErrors(validator.errors ?? []);
}
