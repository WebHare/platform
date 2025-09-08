import * as test from "@webhare/test-backend";
import { Money } from "@webhare/std";
import { generateODS, type SpreadsheetColumn } from "@webhare/office-formats";
import { storeDiskFile } from "@webhare/system-tools";

const columns: SpreadsheetColumn[] =
  [
    { name: "title", title: "Col 1:title", type: "string" },
    { name: "bool", title: "Col 2:bool", type: "boolean" },
    { name: "date", title: "Col 3:date", type: "date" },
    { name: "int", title: "Col 4:int", type: "number" },
    { name: "time", title: "Col 5:time", type: "time" },
    { name: "dt", title: "Col 7:datetime", type: "dateTime", storeUTC: true },
    { name: "mf", title: "Col 8:mf", type: "money" },
    // { name: "sa", title: "Col 9:stringarray", type: "string" }, //should we support string arrays?
    { name: "int64", title: "Col 10:int64", type: "number" },
    { name: "floating", title: "Col 11:floating", type: "number", decimals: 3 }
  ];

const now = new Date("2011-12-08T07:58:12");
const sometime = new Date("2011-11-09T00:06:06");

const reftrestrows = [
  {
    title: "Ti<>tle 1",
    bool: true,
    date: now,
    int: 17,
    time: now.getTime() % 86400_000,
    dt: now,
    mf: new Money("1.5"),
    // sa: ["a", "2"],
    int64: 0,
    floating: 3.5
  }, {
    title: "Tit&le 2\nnext line!",
    bool: false,
    date: sometime,
    int: 666,
    time: 666_000, //666 secs after midnight = 00:11:06 or 12:11:06 AM
    dt: sometime,
    mf: new Money("2.5"),
    // sa: [3, 4],
    int64: -10000000000,
    floating: 1.30000000004
  }, {
    title: "Third row",
    bool: false,
    date: null,
    int: 0,
    time: 0,
    dt: null,
    mf: new Money("0"),
    // sa: [],
    int64: 0,
  }
];

export async function testODSColumnFiles() {
  const output2 = await generateODS({
    rows: reftrestrows,
    columns,
    timeZone: "Europe/Amsterdam",
    split: { rows: 1 },
    withAutoFilter: true,
  });
  test.eq(/\.ods$/, output2.name);

  await storeDiskFile("/tmp/test_ods_columnfiles.ods", output2, { overwrite: true });

  await generateODS({
    sheets: [
      { columns, rows: reftrestrows, timeZone: "Europe/Amsterdam" },
      { columns, rows: reftrestrows, timeZone: "Europe/Amsterdam" },
    ],
  });
  await generateODS({
    sheets: [
      { columns, rows: reftrestrows },
      { columns, rows: reftrestrows },
    ],
    timeZone: "Europe/Amsterdam"
  });
}

test.runTests([
  //Basic output
  testODSColumnFiles,
]);
