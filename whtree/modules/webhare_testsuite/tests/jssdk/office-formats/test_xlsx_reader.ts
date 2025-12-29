/* @ts-expect-error -- still needs typings */
import XlsxStreamReader from "../../../../../jssdk/xlsx-stream-reader/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as test from "@webhare/test-backend";

type WorkSheetReader = any;

function consumeXlsxFile(cb: any) {
  const workBookReader = new XlsxStreamReader();
  workBookReader.on('worksheet', (sheet: any) => sheet.process());
  workBookReader.on('end', cb);
  return workBookReader;
}

async function testStreamingReader() {
  //it supports predefined formats
  {
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/predefined_formats.xlsx')).pipe(workBookReader);
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
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/import.xlsx')).pipe(workBookReader);
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
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/date1904.xlsx')).pipe(workBookReader);
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
  //it catches zip format errors
  {
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/notanxlsx')).pipe(workBookReader);
    workBookReader.on('error', (err: any) => {
      test.eq('invalid signature: 0x6d612069', err.message);
      done.resolve();
    });
    await done.promise;
  }
  //it parses a file with no number format ids
  {
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    fs.createReadStream(path.join(__dirname, 'data/nonumfmt.xlsx')).pipe(workBookReader);
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
  //it parses two files
  {
    const file1 = 'data/import.xlsx';
    const file2 = 'data/file_with_2_sheets.xlsx';
    const done = Promise.withResolvers<void>();
    let finishedStreamCount = 0;
    const endStream = function () {
      finishedStreamCount++;

      if (finishedStreamCount === 2) {
        done.resolve();
      }
    };

    fs.createReadStream(path.join(__dirname, file1)).pipe(consumeXlsxFile(endStream));
    fs.createReadStream(path.join(__dirname, file2)).pipe(consumeXlsxFile(endStream));
    await done.promise;
  }
  //it support rich-text
  {
    const workBookReader = new XlsxStreamReader({ saxTrim: false });
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/richtext.xlsx')).pipe(workBookReader);
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
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    const rows: any = [];
    fs.createReadStream(path.join(__dirname, 'data/uppercase_sheet_name.xlsx')).pipe(workBookReader);
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
    workBookReader.on('end', function () {
      if (!rows.length)
        done.reject(new Error('Read nothing'));
    });
    await done.promise;
  }
  //it parse 0 as 0
  {
    const workBookReader = new XlsxStreamReader();
    const done = Promise.withResolvers<void>();
    fs.createReadStream(path.join(__dirname, 'data/issue_44_empty_0.xlsx')).pipe(workBookReader);
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
