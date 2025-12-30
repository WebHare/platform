import { openXlsxFromDisk, type XlsxRow } from "@webhare/xlsx-reader";
import * as path from "node:path";
import * as test from "@webhare/test-backend";

async function testStreamingReader() {
  //it supports predefined formats
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/predefined_formats.xlsx'));
    test.eq([{ name: "Foglio1", sheetPath: "worksheets/sheet1.xml" }], workBookReader.getSheets());

    const sheet1byid = workBookReader.openSheet(0);
    test.eq('Foglio1', sheet1byid.name);

    const sheet1byname = workBookReader.openSheet("Foglio1");
    test.eq('Foglio1', sheet1byname.name);

    const rows: XlsxRow[] = await Array.fromAsync(sheet1byname.rows());
    test.eq('9/27/86', rows[1][4]);
    test.eq('20064', rows[1][8]);
  }

  //multiple worksheets
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/file_with_2_sheets.xlsx'));
    test.eq([
      { name: "Foglio1", sheetPath: "worksheets/sheet1.xml" },
      { name: "Sheet1", sheetPath: "worksheets/sheet2.xml" }
    ], workBookReader.getSheets());
  }

  //it supports custom formats
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/import.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());

    test.eq('27/09/1986', rows[1][2]);
    test.eq('20064', rows[1][3]);
  }
  //it supports date formate 1904
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/date1904.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());

    test.eq('27/09/1986', rows[1][2]);
  }
  //it catches zip format errors  FIXME nicer error not talking about ZIP but clearer about XLSX
  await test.throws(/is not a valid.*file/, () => openXlsxFromDisk(path.join(__dirname, 'data/notanxlsx')));

  //it parses a file with no number format ids
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/nonumfmt.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());
    test.eq('lambrate', rows[1][1]);
  }
  //it support rich-text
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/richtext.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());
    test.eq('B cell', rows[0][2]);
    test.eq('C cell', rows[0][3]);
  }
  //it parses a file having uppercase in sheet name and mixed first node
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/uppercase_sheet_name.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());
    test.eq(24, rows.length);
    test.eq(['Category ID', 'Parent category ID', 'Name DE', 'Name FR', 'Name IT', 'Name EN', 'GS1 ID'], rows[0].slice(1));
  }
  //it parse 0 as 0
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/issue_44_empty_0.xlsx'));
    const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());

    test.eq(0, rows[1][1]);
    test.eq(1, rows[1][2]);
  }
}

test.run([testStreamingReader]);
