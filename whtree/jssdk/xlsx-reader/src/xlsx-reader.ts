// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/xlsx-reader" {
}

import { unpackArchive, unpackArchiveFromDisk, type UnpackArchiveResult } from '@webhare/zip';
import XlsxStreamReaderWorkBook from './workbook';

export type { XlsxRow, XlsxCellValue } from './worksheet';
export type { XlsxStreamReaderWorkBook };

export interface OpenXlsxOptions {
  rawStringCells?: boolean;
}

async function XlsxReader(source: UnpackArchiveResult, options: OpenXlsxOptions = {}): Promise<XlsxStreamReaderWorkBook> {
  const workbook = new XlsxStreamReaderWorkBook(source, options);
  await workbook.ready;
  return workbook;
}

export async function openXlsx(source: Blob, options?: OpenXlsxOptions): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchive(source);
  return XlsxReader(unzipped, options);
}

export async function openXlsxFromDisk(source: string, options?: OpenXlsxOptions): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchiveFromDisk(source);
  return XlsxReader(unzipped, options);
}
