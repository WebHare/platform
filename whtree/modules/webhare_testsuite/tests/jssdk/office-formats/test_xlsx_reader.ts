import { openXlsxFromDisk } from "@webhare/xlsx-reader";
import * as path from "node:path";
import * as test from "@webhare/test-backend";

type WorkSheetReader = any;

async function testStreamingReader() {
  //it supports predefined formats
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/predefined_formats.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq('9/27/86', rows[1][4]);
        test.eq('20064', rows[1][8]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it supports custom formats
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/import.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq('27/09/1986', rows[1][2]);
        test.eq('20064', rows[1][3]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it supports date formate 1904
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/date1904.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq('27/09/1986', rows[1][2]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it catches zip format errors  FIXME nicer error not talking about ZIP but clearer about XLSX
  await test.throws(/is not a valid.*file/, () => openXlsxFromDisk(path.join(__dirname, 'data/notanxlsx')));

  //it parses a file with no number format ids
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/nonumfmt.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq('lambrate', rows[1][1]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it support rich-text
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/richtext.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq('B cell', rows[0][2]);
        test.eq('C cell', rows[0][3]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it parses a file having uppercase in sheet name and mixed first node
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/uppercase_sheet_name.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq(24, rows.length);
        test.eq(['Category ID', 'Parent category ID', 'Name DE', 'Name FR', 'Name IT', 'Name EN', 'GS1 ID'], rows[0].slice(1));
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
  //it parse 0 as 0
  {
    const workBookReader = await openXlsxFromDisk(path.join(__dirname, 'data/issue_44_empty_0.xlsx'));
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    workBookReader.on('worksheet', (workSheetReader: WorkSheetReader) => {
      workSheetReader.on('end', function () {
        test.eq(0, rows[1][1]);
        test.eq(1, rows[1][2]);
        done.resolve();
      });
      workSheetReader.on('row', (r: any) => {
        rows.push(r.values);
      });
      workSheetReader.process();
    });
    await done.promise;
  }
}

test.run([testStreamingReader]);
