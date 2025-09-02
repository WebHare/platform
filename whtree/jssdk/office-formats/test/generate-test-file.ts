import { rmSync, writeFileSync } from "node:fs";
import { generateXLSX } from "../src/xlsx-output";
import type { SpreadsheetColumn } from "../src/support";

const [, , outputfile, rest] = process.argv;

if (!outputfile || rest) {
  console.error("Syntax: generate-test-file <outfile>");
  process.exit(1);
}

const columns: SpreadsheetColumn[] = [
  {
    name: "a",
    title: "a",
    type: 'string'
  }, {
    name: "b",
    title: "b",
    type: 'string'
  },
] as const;

const rows = [{ a: "a1", b: "b1" }, { a: "a2", b: "b2" }];

async function generateTestFile() {
  const xlsxdata: File = await generateXLSX({
    columns,
    rows,
    split: { rows: 1, columns: 1 },
    withAutoFilter: true,
  });

  rmSync(outputfile, { force: true });
  writeFileSync(outputfile, await xlsxdata.bytes());
  console.log(`Wrote ${outputfile}`);
}

void generateTestFile();
