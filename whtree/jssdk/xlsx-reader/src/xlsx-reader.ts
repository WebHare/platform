// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/xlsx-reader" {
}

import { unpackArchive, unpackArchiveFromDisk, type UnpackArchiveResult } from '@webhare/zip';
import XlsxStreamReaderWorkBook from './workbook';

export interface OpenXlsxOptions {
  verbose: boolean;
  formatting: boolean;
}

export function XlsxReader(source: UnpackArchiveResult, options: Partial<OpenXlsxOptions> = {}): XlsxStreamReaderWorkBook {
  if (!options || typeof options !== 'object') {
    options = {};
  }

  if (typeof options.verbose === 'undefined') options.verbose = true;
  if (typeof options.formatting === 'undefined') options.formatting = true;

  const instanceOptions = {
    saxStrict: true,
    saxNormalize: true,
    saxPosition: true,
    saxStrictEntities: true,
    verbose: options.verbose,
    formatting: options.formatting
  };

  return new XlsxStreamReaderWorkBook(source, instanceOptions);
}

export async function openXlsx(source: Blob, options?: Partial<OpenXlsxOptions>): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchive(source);
  return XlsxReader(unzipped, options);
}

export async function openXlsxFromDisk(source: string, options?: Partial<OpenXlsxOptions>): Promise<XlsxStreamReaderWorkBook> {
  const unzipped = await unpackArchiveFromDisk(source);
  return XlsxReader(unzipped, options);
}
