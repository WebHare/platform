import * as test from "@webhare/test-backend";
import { generateXLSX, type SpreadsheetColumn } from "@webhare/office-formats";
import { Money, pick } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { storeDiskFile } from "@webhare/system-tools";
import { DOMParser, type Document } from "@xmldom/xmldom";
import { isValidSheetName } from "@webhare/office-formats/src/support";

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
    { name: "int64", title: "Col 10:int64", type: "number" }
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

async function getSheet1(xlsx: Blob): Promise<Document> {
  const result = await loadlib("mod::system/whlibs/filetypes/archiving.whlib").UnpackArchive(await WebHareBlob.fromBlob(xlsx));
  const sheet1blob = result.find((_: any) => _.name === "sheet1.xml");;
  test.assert(sheet1blob);
  return new DOMParser().parseFromString(await (sheet1blob.data as WebHareBlob).text(), 'text/xml');
}

async function testSheetsApi() {
  test.assert(!isValidSheetName(""));
  test.assert(!isValidSheetName("History"));
  test.assert(!isValidSheetName("history"));
  test.assert(!isValidSheetName(" Sheet1"));
  test.assert(!isValidSheetName("Sheet1 "));
  test.assert(isValidSheetName("Sheet 1"));
  test.assert(!isValidSheetName("02/17/2016"));
  test.assert(isValidSheetName("02-17-2016"));
  test.assert(!isValidSheetName("'Sheet1"));
  test.assert(!isValidSheetName("Sheet1'"));
  test.assert(!isValidSheetName("Sheet\n"));
  test.assert(isValidSheetName("Sheet'1"));
  test.assert(isValidSheetName("1234567890123456789012345678901"));
  test.assert(!isValidSheetName("12345678901234567890123456789012"));
  for (const badchar of '/\\?*:[]'.split(""))
    test.assert(!isValidSheetName("Sheet " + badchar), `Sheetname 'Sheet ${badchar}' should be invalid`);
  for (const goodchar of '!@™€'.split(""))
    test.assert(isValidSheetName("Sheet " + goodchar), `Sheetname 'Sheet ${goodchar}' should be valid`);
}


export async function testXLSXColumnFiles() {
  //@ts-expect-error - Column definition is also rejected by TS
  const incopmpleteColums: SpreadsheetColumn[] = [{ name: "date", type: "dateTime" }];
  await test.throws(/storeUTC/, generateXLSX({ rows: reftrestrows, columns: incopmpleteColums }));
  await test.throws(/no timeZone/, generateXLSX({ rows: reftrestrows, columns: columns.filter(_ => _.type === "dateTime").map(_ => ({ ..._, storeUTC: true })) }));
  await test.throws(/no timeZone/, generateXLSX({ rows: reftrestrows, columns: columns }));

  //FIXME don't allow 'old' timezone names, actually apply timezones to the export format
  const output2 = await generateXLSX({ rows: reftrestrows, columns, timeZone: "CET" });
  test.eq(/\.xlsx$/, output2.name);

  await storeDiskFile("/tmp/test_xlsx_columnfiles.xlsx", output2, { overwrite: true });

  //debug using HS apis
  const sheet1xml2 = await getSheet1(output2);

  //Verify the \n was written as \r
  const nodewithlinefeed = sheet1xml2.getElementsByTagName("c").filter(_ => _.getAttribute("r") === "A3")[0];
  test.eq("Tit&le 2\rnext line!", nodewithlinefeed.textContent);

  const xlsxin = await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").OpenOOXMLSpreadSheetFile(await WebHareBlob.fromBlob(output2));
  test.assert(xlsxin);

  const xlssheet = await xlsxin.OpenSheet(0);
  const outrows = await xlssheet.GetAllRows();

  test.eq(4, outrows.length);
  test.eq(columns.length, outrows[0].length);
  for (const [idx, col] of columns.entries()) {
    test.eq(col.title, outrows[0][idx]);
  }

  test.eq(columns.length, outrows[1].length);
  test.eq("Ti<>tle 1", outrows[1][0]);
  test.eq(true, outrows[1][1]);

  const nowRounded = new Date(now.toISOString().substring(0, 10) + "T00:00:00Z");
  test.eq(nowRounded, outrows[1][2]);
  test.eq(17, outrows[1][3]);
  test.eq((now.getTime() % 86400_000) / 86400_000, outrows[1][4]);

  test.eq(now, outrows[1][5]);
  test.eq(1.5, outrows[1][6]);
  test.eq(0, outrows[1][7]);

  test.eq("", outrows[3][2]);
  test.eq(0, outrows[3][6]);

  test.eq(columns.length, outrows[2].length);
  test.eq("Tit&le 2\nnext line!", outrows[2][0]);
  test.eq(false, outrows[2][1]);

  const sometimeRounded = new Date(sometime.toISOString().substring(0, 10) + "T00:00:00Z");
  test.eq(sometimeRounded, outrows[2][2]);
  test.eq(666, outrows[2][3]);
  test.eq(666 / 86400, outrows[2][4]);
  test.eq(sometime, outrows[2][5]);
  test.eq(2.5, outrows[2][6]);
  test.eq(-10000000000, outrows[2][7]);

  //The rest of testXLSXColumnFiles was testing various parse modes (eg alltostring TRUE, floatmode 'money' not the generator )
}

async function testXLSXMultipleSheets() {
  const sheet1 = {
    rows: reftrestrows.map(_ => pick(_, ["title", "date"])),
    columns: columns.filter(_ => ['title', 'date'].includes(_.name)),
    title: "First Sheet"
  };

  const sheet2 = {
    rows: [reftrestrows[1]],
    columns: columns.filter(_ => ['title', 'bool'].includes(_.name)),
  };

  const sheet3 = {
    rows: [],
    columns: columns,
    title: "Empty Sheet"
  };

  const output = await generateXLSX({
    title: "Cool document",
    timeZone: "Europe/Amsterdam",
    sheets: [sheet1, sheet2, sheet3]
  });
  await storeDiskFile("/tmp/test_xlsx_multiple_sheets.xlsx", output, { overwrite: true });

  test.eq(/\.xlsx$/, output.name);
  test.eq('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', output.type);

  const xlsxin = await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").OpenOOXMLSpreadSheetFile(await WebHareBlob.fromBlob(output));
  // console.log(await )
  test.eqPartial([
    { sheetnr: 0, name: 'First Sheet', sheetid: '1' },
    { sheetnr: 1, name: 'Sheet2', sheetid: '2' },
    { sheetnr: 2, name: 'Empty Sheet', sheetid: '3' }
  ], await xlsxin.getSheets());

  const xlssheet = await xlsxin.OpenSheet(1);
  const outrows = await xlssheet.GetAllRows();
  test.eq([['Col 1:title', 'Col 2:bool'], ['Tit&le 2\nnext line!', false]], outrows);

}

test.runTests([
  testSheetsApi,
  testXLSXColumnFiles,
  testXLSXMultipleSheets
]);
