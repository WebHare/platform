import * as test from "@webhare/test-backend";
import { generateXLSX, type SpreadsheetColumn } from "@webhare/office-formats";
import { Money, omit, pick } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { DOMParser, type Document } from "@xmldom/xmldom";
import { isValidSheetName } from "@webhare/office-formats/src/support";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { openXlsx } from "@webhare/xlsx-reader";

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

async function getSheet1(xlsx: Blob): Promise<Document> {
  const result = await loadlib("mod::system/whlibs/filetypes/archiving.whlib").UnpackArchive(await WebHareBlob.fromBlob(xlsx));
  const sheet1blob = result.find((_: any) => _.name === "sheet1.xml");
  test.assert(sheet1blob);
  return new DOMParser().parseFromString(await (sheet1blob.data as WebHareBlob).text(), 'text/xml');
}

async function getSharedStrings(xlsx: Blob): Promise<Document> {
  const result = await loadlib("mod::system/whlibs/filetypes/archiving.whlib").UnpackArchive(await WebHareBlob.fromBlob(xlsx));
  const sheet1blob = result.find((_: any) => _.name === "sharedStrings.xml");
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

async function getRows(xlsx: File) {
  const xlsxin = await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").OpenOOXMLSpreadSheetFile(await WebHareBlob.fromBlob(xlsx));
  test.assert(xlsxin);

  const xlssheet = await xlsxin.OpenSheet(0);
  const outrows = await xlssheet.GetAllRows();
  return outrows;
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
  // await storeDiskFile("/tmp/test_xlsx_columnfiles.xlsx", output2, { overwrite: true });

  //debug using HS apis
  const sheet1xml2 = await getSheet1(output2);
  const sharedStrings = await getSharedStrings(output2);

  //Verify the \n was written as \r
  const nodewithlinefeed = sheet1xml2.getElementsByTagName("c").filter(_ => _.getAttribute("r") === "A3")[0];

  test.eq("s", nodewithlinefeed.getAttribute("t"));
  const nodewithlinefeed_v = Number(nodewithlinefeed.textContent?.trim());
  const nodewithlinefeed_text = sharedStrings.getElementsByTagName("si")[nodewithlinefeed_v].getElementsByTagName("t")[0].textContent; //This is the shared string index, which is used to reference the string in the sharedStrings.xml file
  test.eq("Tit&le 2\nnext line!", nodewithlinefeed_text);

  const outrows = await getRows(output2);

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

  test.eq(now.toTemporalInstant().toZonedDateTimeISO("CET").toPlainDateTime().toString(), (outrows[1][5] as Date).toTemporalInstant().toString().replace("Z", ""));
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
  test.eq(sometime.toTemporalInstant().toZonedDateTimeISO("CET").toPlainDateTime().toString(), (outrows[2][5] as Date).toTemporalInstant().toString().replace("Z", ""));
  test.eq(2.5, outrows[2][6]);
  test.eq(-10000000000, outrows[2][7]);


  // Compare all non-undefined columns to the HS output
  const output2_hs = (await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").GenerateXLSXFile({
    rows: reftrestrows.map(row => ({ ...row, time: new Date(row.time), dt: row.dt || defaultDateTime, date: row.date || defaultDateTime, floating: row.floating ?? 0 })),
    columns: columns.map(c => ({ ...omit(c, ["decimals"]), type: c.type === "number" ? "float" : c.type.toLowerCase() })),
    timeZone: "CET"
  })).data;
  const outrows2 = await getRows(output2_hs);
  for (const [rownr, row] of outrows.entries()) {
    for (const [colnr, col] of row.entries()) {
      if (col !== undefined) {
        test.eq(outrows2[rownr][colnr], col, {
          annotation: `Row ${rownr}, Col ${colnr} compare JS vs HS`,
          onCompare: (jsValue, hsValue) => {
            if (typeof jsValue === "number" && typeof hsValue === "number")
              return Math.abs(jsValue - hsValue) < 0.0001; // Allow for minor floating point differences
          }
        });
      }
    }
  }


  //The rest of testXLSXColumnFiles was testing various parse modes (eg alltostring TRUE, floatmode 'money' not the generator )
}

async function testAutoXLSXColumnFiles() {
  //Often we don't really care to exactly define an output format - eg an internal used one-off format. We can always go back and specify columns!
  const doc = await generateXLSX({ rows: reftrestrows });
  test.eq([
    [
      'title', 'bool',
      'date', 'int',
      'time', 'dt',
      'mf', 'int64',
      'floating'
    ],
    [
      'Ti<>tle 1',
      'true',
      'Thu Dec 08 2011 07:58:12 GMT+0100 (Central European Standard Time)',
      '17',
      '25092000',
      'Thu Dec 08 2011 07:58:12 GMT+0100 (Central European Standard Time)',
      '1.5',
      '0',
      '3.5'
    ],
    [
      'Tit&le 2\nnext line!',
      'false',
      'Wed Nov 09 2011 00:06:06 GMT+0100 (Central European Standard Time)',
      '666',
      '666000',
      'Wed Nov 09 2011 00:06:06 GMT+0100 (Central European Standard Time)',
      '2.5',
      '-10000000000',
      '1.30000000004'
    ],
    ['Third row', 'false', '', '0', '0', '', '0', '0']
  ], await getRows(doc));
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

  const sheet4 = {
    rows: [],
    title: "Truly Empty Sheet"
  };

  const output = await generateXLSX({
    title: "Cool document",
    timeZone: "Europe/Amsterdam",
    sheets: [sheet1, sheet2, sheet3, sheet4],
    split: { rows: 1 },
    withAutoFilter: true
  });
  // await storeDiskFile("/tmp/test_xlsx_multiple_sheets.xlsx", output, { overwrite: true });

  test.eq(/\.xlsx$/, output.name);
  test.eq('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', output.type);

  const xlsxin = await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").OpenOOXMLSpreadSheetFile(await WebHareBlob.fromBlob(output));
  test.eqPartial([
    { sheetnr: 0, name: 'First Sheet', sheetid: '1' },
    { sheetnr: 1, name: 'Sheet2', sheetid: '2' },
    { sheetnr: 2, name: 'Empty Sheet', sheetid: '3' },
    { sheetnr: 3, name: 'Truly Empty Sheet', sheetid: '4' }
  ], await xlsxin.getSheets());

  const xlssheet = await xlsxin.OpenSheet(1);
  const outrows = await xlssheet.GetAllRows();
  test.eq([['Col 1:title', 'Col 2:bool'], ['Tit&le 2\nnext line!', false]], outrows);

  const xlssheet3 = await xlsxin.OpenSheet(3);
  const outrows3 = await xlssheet3.GetAllRows();
  test.eq([[]], outrows3);
}

async function testXLSXRegressions() {
  const output = await generateXLSX({
    rows: [
      { dt: defaultDateTime, marker: "A" },
      { dt: maxDateTime, marker: "B" },
      { dt: new Date("2015-12-11T12:00:00Z"), marker: "C" }
    ],
    columns: [
      { name: "dt", title: "DateTime", type: "dateTime", storeUTC: true },
      { name: "marker", title: "Marker", type: "string" }//just to ensure all cells are actually rendered
    ],
    timeZone: "UTC"
  });

  const readback = await Array.fromAsync((await openXlsx(output, { rawStringCells: true })).openSheet(0).rows());
  test.eq([
    ['DateTime', "Marker"],
    [null, "A"],
    [null, "B"],
    ["42349.5", "C"]
  ], readback, "Shouldn't see the extreme time values");

}

test.runTests([
  testSheetsApi,
  testXLSXColumnFiles,
  testAutoXLSXColumnFiles,
  testXLSXMultipleSheets,
  testXLSXRegressions
]);
