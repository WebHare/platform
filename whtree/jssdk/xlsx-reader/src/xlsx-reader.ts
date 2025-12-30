// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/xlsx-reader" {
}

import { unpackArchive, unpackArchiveFromDisk, type UnpackArchiveResult } from '@webhare/zip';
import XlsxStreamReaderWorkBook from './workbook';

export type { XlsxRow } from './worksheet';

export interface OpenXlsxOptions {
  verbose: boolean;
}

async function XlsxReader(source: UnpackArchiveResult, options: Partial<OpenXlsxOptions> = {}): Promise<XlsxStreamReaderWorkBook> {
  if (!options || typeof options !== 'object') {
    options = {};
  }

  if (typeof options.verbose === 'undefined') options.verbose = true;

  const instanceOptions = {
    saxStrict: true,
    verbose: options.verbose,
  };

  const workbook = new XlsxStreamReaderWorkBook(source, instanceOptions);
  await workbook.ready;
  return workbook;
}

export async function openXlsx(source: Blob, options?: Partial<OpenXlsxOptions>): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchive(source);
  return XlsxReader(unzipped, options);
}

export async function openXlsxFromDisk(source: string, options?: Partial<OpenXlsxOptions>): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchiveFromDisk(source);
  return XlsxReader(unzipped, options);
}
