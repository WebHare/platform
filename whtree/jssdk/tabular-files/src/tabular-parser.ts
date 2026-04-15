export type TabularCellValue = string | number | Temporal.PlainDate | boolean | null;
export type TabularRow = TabularCellValue[];

/**
 * Configuration for a single output property.
 *
 * - `header`: expected column header text (case-insensitive exact match).
 * - `optional`: when true the column may be absent; otherwise a missing column produces a "missing-column" error.
 * - `type`: one of "string", "number" or "boolean". Defaults to "string" when omitted.
 *
 * For string fields you may provide `maxLength` and `allowedValues` (use `as const` to narrow TypeScript types).
 * For number fields you may provide `allowedValues` (use `as const`).
 */
export type TabularField = {
  /** Header we expect this field to have */
  header: string;
  /** Set if this field doesn't need to appear as on of the columns in the import */
  optional?: boolean;
  /** Expected data type. Defaults to string */
  type?: "string" | "number" | "boolean";

} & ({
  type?: "string" | never;
  /** Maximum length for string fields */
  maxLength?: number;
  /** Limit allowed values for the field. Pass these 'as const' to reflect these limited values in the output type */
  allowedValues?: readonly string[];
} | {
  type: "number";
  /** Limit allowed values for the field. Pass these 'as const' to reflect these limited values in the output type */
  allowedValues?: readonly number[];
} | {
  type: "boolean";
});

export type TabularFields = Record<string, TabularField>;

/**
 * Structured error returned by the parser when input cannot be converted to rows.
 *
 * `type` is one of:
 * - "ambiguous-column" — header matched multiple columns
 * - "missing-data" — no rows in the sheet
 * - "missing-column" — a required field's header wasn't found
 * - "invalid-data" — cell value failed validation or conversion
 * - "too-many-errors" — error list truncated
 *
 * `row` is a 1-based row number (header row is row 1). `field` and `fieldHeader` are set when the error relates to a specific configured field.
 */
export type TabularImportError = {
  // cellName: string;
  row: number;
  type: "ambiguous-column" | "missing-data" | "missing-column" | "invalid-data" | "too-many-errors";
  field?: string;
  fieldHeader?: string;
  message: string;
};

/**
 * Compute the TypeScript output type for a configured field. If `allowedValues` is present
 * and supplied `as const` it narrows the resulting union to those literal values.
 */
type ValueTypForField<Field extends TabularField> = Field["type"] extends "boolean" ? boolean :
  Field extends { allowedValues: infer AV } ? AV extends readonly unknown[] ? AV[number] : never :
  Field["type"] extends "number" ? number : string;

type OptionalFieldKeys<Fields extends TabularFields> = {
  [K in keyof Fields]: Fields[K] extends { optional: true } ? K : never;
}[keyof Fields];

type RequiredFieldKeys<Fields extends TabularFields> = Exclude<keyof Fields, OptionalFieldKeys<Fields>>;

/**
 * The shape of a parsed output row derived from the configured fields.
 * Required configured fields appear as required properties; optional configured fields
 * appear as optional properties in the result type.
 */
export type OutputRowForFields<Fields extends TabularFields> =
  { -readonly [K in RequiredFieldKeys<Fields>]: ValueTypForField<Fields[K]> } &
  { -readonly [K in OptionalFieldKeys<Fields>]?: ValueTypForField<Fields[K]> };

/**
 * Parse tabular input into typed rows according to `fields`.
 *
 * @typeParam Fields - a record mapping output property names to `TabularField` descriptors
 * @param fields - field configuration (header names, types, validations)
 * @param data - tabular input where `data[0]` is the header row
 * @param options.maxErrors - maximum errors to collect before truncating
 * @returns either `{ rows: OutputRowForFields<Fields>[] }` on success or `{ errors: TabularImportError[] }` on failure
 *
 * Example:
 * ```ts
 * const result = parseTabularData({
 *   code: { header: 'Program code' },
 *   active: { header: 'Active', type: 'boolean', optional: true }
 * } as const, rows);
 * // result.rows -> [{ code: 'EMM', active: true }, ...] OR { errors: [...] }
 * ```
 */
export function parseTabularData<Fields extends TabularFields>(
  fields: Fields,
  data: TabularRow[],
  options?: {
    maxErrors?: number;
  }): {
    errors: TabularImportError[];
    rows?: never;
  } | {
    rows: OutputRowForFields<Fields>[];
    errors?: never;
  } {
  type RowType = OutputRowForFields<Fields>;
  const rows: RowType[] = [];
  const errors: TabularImportError[] = [];
  const maxErrors = options?.maxErrors ?? 100;

  function addError(error: TabularImportError, field?: typeof mappedFields[0]) {
    if (field)
      error = { ...error, field: field.name as string, fieldHeader: field.header };

    if (errors.length < maxErrors)
      errors.push(error);
    if (errors.length === maxErrors)
      errors.push({ row: error.row, type: "too-many-errors", message: `Too many errors, further errors are not recorded` });
  }

  if (data.length < 1) {
    addError({ row: 1, type: "missing-data", message: "No rows found in the sheet" });
    return { errors };
  }

  // Figure out which column heders correspond to which fields
  const headers = data[0].map(h => h?.toString() || '');
  // Flat list of fields to take
  const mappedFields = Object.entries(fields).map(([name, settings]) => ({
    ...settings,
    name: name as keyof RowType,
    position: null as number | null,
    actualHeader: null as string | null
  }));

  // Check all required fields are present
  for (const field of mappedFields) {
    const matchHeader = [...headers.entries()].filter(([_, h]) => h.toLowerCase() === field.header.toLowerCase());
    if (matchHeader.length >= 1) {
      if (matchHeader.length > 1)
        addError({ row: 1, type: "ambiguous-column", message: `Ambiguous column header '${field.header}' matches multiple columns in the data` }, field);

      field.position = matchHeader[0][0];
      field.actualHeader = matchHeader[0][1]?.toString() || '';
    } else if (!field.optional) {
      addError({ row: 1, type: "missing-column", message: `Missing column '${field.header}'` }, field);
    }
  }

  for (const [rowIndex, row] of data.slice(1).entries()) {
    const outputRow: Partial<OutputRowForFields<Fields>> = {};

    for (const field of mappedFields) {
      if (field.position === null && field.optional)
        continue;

      const cellValue = field.position !== null ? row[field.position] ?? null : null;
      let parsedValue: TabularCellValue = cellValue;
      switch (field.type) {
        case "number":
          parsedValue = parseFloat(String(cellValue));
          if (isNaN(parsedValue)) {
            addError({ type: "invalid-data", row: rowIndex + 2, message: `Invalid number for field '${field.header}' at row ${rowIndex + 2}` }, field);
            continue;
          }
          if (field.allowedValues && !field.allowedValues.includes(parsedValue)) {
            addError({ type: "invalid-data", row: rowIndex + 2, message: `Value ${parsedValue} not allowed for field '${field.header}' at row ${rowIndex + 2}` }, field);
            continue;
          }
          break;

        case "boolean":
          if (typeof cellValue === "boolean") {
            parsedValue = cellValue;
          } else if (typeof cellValue === "string") {
            if (cellValue.toLowerCase() === "true") {
              parsedValue = true;
            } else if (cellValue.toLowerCase() === "false") {
              parsedValue = false;
            } else {
              addError({ type: "invalid-data", row: rowIndex + 2, message: `Invalid boolean for field '${field.header}' at row ${rowIndex + 2}` }, field);
              continue;
            }
          }
          break;

        default: //String
          parsedValue = cellValue ? String(cellValue) : "";
          if (field.maxLength !== undefined && parsedValue.length > field.maxLength) {
            addError({ type: "invalid-data", row: rowIndex + 2, message: `String of length ${parsedValue.length} exceeds maximum length of ${field.maxLength} for field '${field.header}' at row ${rowIndex + 2}` }, field);
            continue;
          }
          if (field.allowedValues && !field.allowedValues.includes(parsedValue)) {
            addError({ type: "invalid-data", row: rowIndex + 2, message: `Value '${parsedValue}' not allowed for field '${field.header}' at row ${rowIndex + 2}` }, field);
            continue;
          }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (outputRow as any)[field.name] = parsedValue;
    }
    rows.push(outputRow as OutputRowForFields<Fields>);
  }

  return errors.length ? { errors } : { rows };
}
