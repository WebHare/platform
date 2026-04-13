# @webhare/tabular-files
Process raw tabular cells into an array of objects. You specify the expected headers and parseTabularData will match the proper columns from eg a XLSX file:

Use `@webhare/xlsx-reader` to turn an Excel (XLSX) file into the tabular data format,

A straightforward example:

```ts
const tabularData = [
  [
    'Program code',
    'Conditions apply',
    'Deficiency credits'
  ],
  [
    'EMM',
    true,
    0
  ],
  [
    'CS',
    false,
    15
  ],
];

const importMap3 = {
  programCode: { header: "Program code" },
  conditionsApply: { header: "Conditions apply", type: "boolean" },
  credits: { header: "Deficiency credits", type: "number" }
} as const;

parseTabularData(importMap3, tabularData);
/* Returns:
    { rows: [ { programCode: "EMM", conditionsApply: true, credits: 0 },
              { programCode: "CS", conditionsApply: false, credits: 15 }
            ]
    }
*/
```

Use `optional: true` to allow a field's column to be absent in the input. If a non-optional field is missing the parser returns errors instead of rows.

```typescript
parseTabularData({
  programCode: { header: "Program code" },
  missingData: { header: "Missing Data", optional: true },
}, tabularData);

/* Returns (success):
   { rows: [
       { programCode: "EMM" },
       { programCode: "CS" }
     ]
   }
*/
```

We also support validations such as `maxLength` and `allowedValues` per field.

Notes and API details
- **Return value:** `parseTabularData` returns either `{ rows: OutputRowForFields<Fields>[] }` on success or `{ errors: TabularImportError[] }` on failure. Each `TabularImportError` contains at least `row` and `message` and may include `type`, `field`, and `fieldHeader`.
- **Default semantics:** If `type` is omitted the field is treated as a `string`. If `optional` is omitted the field is considered required (i.e. `optional: false`).
- **`allowedValues`:** Pass `allowedValues` `as const` to get narrowed TypeScript output types (e.g. `allowedValues: ["A","B"] as const` narrows the output field to the union `"A" | "B"`).

Field examples

String field with max length and allowed values:

```ts
title: { header: "Program title", type: "string", maxLength: 100, allowedValues: ["Short","Long"] as const }
```

Number field with allowed values:

```ts
credits: { header: "Deficiency credits", type: "number", allowedValues: [0, 15] as const }
```

Boolean field:

```ts
active: { header: "Active", type: "boolean" }
```

Error examples

```js
{ errors: [
  { row: 1, type: "missing-column", field: "programCode", fieldHeader: "Program code", message: "Missing column 'Program code'" }
]}
```

The parser emits error `type` values such as `"ambiguous-column"`, `"missing-column"`, `"invalid-data"`, `"missing-data"` and `"too-many-errors"`.
