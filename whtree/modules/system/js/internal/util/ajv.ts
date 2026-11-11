import type { ErrorObject } from "ajv";

/** Describe a single ajv validation error, eg `must have required property 'email' (missingProperty="email")` */
function describeAjvError(error: ErrorObject): string {
  /* The error looks like this:
  >   {
        instancePath: '',
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'email' },
        message: "must have required property 'email'"
      }
  */
  const params = Object.entries(error.params).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
  return `${error.message ?? "invalid value"}${params ? ` (${params})` : ``}${(error.instancePath ? ` (at ${JSON.stringify(error.instancePath)})` : "")}`;
}

/** Format the first of a list of ajv validation errors */
export function formatAjvError(errors: ErrorObject[]): string {
  return describeAjvError(errors[0]);
}

/** Format all ajv validation errors (from a validator with allErrors set), separated by semicolons */
export function formatAjvErrors(errors: ErrorObject[]): string {
  return errors.map(describeAjvError).join("; ");
}
