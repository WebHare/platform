import * as test from "@webhare/test-backend";
import { parseTabularData, type TabularFields } from "@webhare/tabular-files";
import type { OutputRowForFields } from "@webhare/tabular-files/src/tabular-parser";

const tabularData = [
  [
    'Program code',
    'Program title',
    'Source',
    'Studyroute source program code',
    'Studyroute source program',
    'Studyroute source croho',
    'Studyroute source organization',
    'Studyroute source organization BRIN',
    'Conditions apply',
    'Conditions (EN)',
    'Conditions (NL)',
    'Deficiency credits'
  ],
  [
    'EMM',
    'Educatie in de Mens- en Maatschappijwetenschappen',
    'External',
    '',
    'Educational Science and Technology',
    '60023',
    'All institutes',
    '',
    true,
    '',
    '',
    0
  ],
  [
    'EMM',
    'Educatie',
    'External',
    '',
    'Communication Science',
    '60713',
    'All institutes',
    '',
    false,
    '',
    '',
    15
  ],
];

function testProcessing() {
  const importMap3 = {
    programCode: { header: "Program code" },
    conditionsApply: { header: "Conditions apply", type: "boolean" },
    credits: { header: "Deficiency credits", type: "number" }
  } as const;

  test.eq({
    rows: [
      { programCode: "EMM", conditionsApply: true, credits: 0 },
      { programCode: "EMM", conditionsApply: false, credits: 15 }
    ]
  }, parseTabularData(importMap3, tabularData));

  test.eq({
    errors: [
      { row: 1, type: "missing-column", field: "brokenData", fieldHeader: "Broken data", message: "Missing column 'Broken data'" }
    ]
  }, parseTabularData({
    programCode: { header: "Program code" },
    missingData: { header: "Missing Data", optional: true },
    brokenData: { header: "Broken data" },
  }, tabularData));

  test.eq({
    rows: [
      { programCode: "EMM" },
      { programCode: "EMM" }
    ]
  }, parseTabularData({
    programCode: { header: "Program code" },
    missingData: { header: "Missing Data", optional: true },
  }, tabularData));

  test.eq({
    errors: [
      { row: 1, type: "ambiguous-column", field: "programCode", fieldHeader: "Program code", message: /Ambiguous column header 'Program code'/ }
    ],
  }, parseTabularData({
    programCode: { header: "Program code" },
  }, [["program code", "PROGRAM CODE"], ["AAA", "BBB"]]));

  test.eq({
    errors: [
      { row: 2, type: "invalid-data", field: "programTitle", fieldHeader: "Program title", message: /String of length 49 exceeds maximum length of 20 for field 'Program title'/ },
      { row: 3, type: "invalid-data", field: "credits", fieldHeader: "Deficiency credits", message: /Invalid number for field 'Deficiency credits'/ }
    ]
  }, parseTabularData({
    credits: { header: "Deficiency credits", type: "number", },
    programTitle: { header: "Program title", type: "string", maxLength: 20, },
  }, [
    ["Deficiency credits", "Program title"],
    [15, "Educatie in de Mens- en Maatschappijwetenschappen"],
    ["Not a number", "Short title"]
  ]));

  const parseResultWithAllowedValues = parseTabularData({
    dogs: { header: "Dogs", type: "number", allowedValues: [0, 1] as const },
    breed: { header: "Breed", type: "string", allowedValues: ["Beagle", "Markies"] as const },
  }, [
    ["Dogs", "Breed"],
    ["2", "Beagle"],
    ["1", "Pitbull"],
    ["0", ""],
    ["", "Markies"],
    ["1"]
  ]);

  test.eq({
    errors: [
      { row: 2, type: "invalid-data", field: "dogs", fieldHeader: "Dogs", message: "Value 2 not allowed for field 'Dogs' at row 2" },
      { row: 3, type: "invalid-data", field: "breed", fieldHeader: "Breed", message: "Value 'Pitbull' not allowed for field 'Breed' at row 3" },
      { row: 4, type: "invalid-data", field: "breed", fieldHeader: "Breed", message: "Value '' not allowed for field 'Breed' at row 4" },
      { row: 5, type: "invalid-data", field: "dogs", fieldHeader: "Dogs", message: "Invalid number for field 'Dogs' at row 5" },
      { row: 6, type: "invalid-data", field: "breed", fieldHeader: "Breed", message: "Value '' not allowed for field 'Breed' at row 6" }
    ]
  }, parseResultWithAllowedValues);

  const parseResultWithAllowedValues2 = parseTabularData({
    dogs: { header: "Dogs", type: "number", allowedValues: [0, 1] as const },
    breed: { header: "Breed", type: "string", allowedValues: ["Beagle", "Markies"] as const },
  }, [
    ["Dogs", "Breed"],
    ["1", "Beagle"],
    ["0", "Markies"],
  ]);
  test.eq({
    rows: [
      { dogs: 1, breed: "Beagle" },
      { dogs: 0, breed: "Markies" }
    ]
  }, parseResultWithAllowedValues2);

  //@ts-expect-error TS knows Pitbull is an invalid value:
  test.assert(parseResultWithAllowedValues2.rows[0].breed !== "Pitbull");
  //@ts-expect-error TS knows 2 is an invalid value:
  test.assert(parseResultWithAllowedValues2.rows[0].dogs !== 2);
}

function testTypes() {
  // Verify allowedValues without a type: string doesn't break TS's type checking
  const testImportMap = {
    source: {
      header: "Source",
      allowedValues: ["External", "Internal"]
    }
  } as const;
  testImportMap satisfies TabularFields;

  const x: OutputRowForFields<typeof testImportMap> = { source: "Internal" };
  x.source = "External";
  //@ts-expect-error TS should not allow arbitrary strings
  x.source = "bad";
}

test.runTests([
  testProcessing,
  testTypes
]);
