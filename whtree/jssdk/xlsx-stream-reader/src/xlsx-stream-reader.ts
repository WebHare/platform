// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/xlsx-stream-reader" {
}

import XlsxStreamReaderWorkBook from './workbook';

export default function XlsxStreamReader(options: Partial<{
  saxTrim: boolean;
  verbose: boolean;
  formatting: boolean;
}> = {}): XlsxStreamReaderWorkBook {
  if (!options || typeof options !== 'object') {
    options = {};
  }

  if (typeof options.saxTrim === 'undefined') options.saxTrim = true;
  if (typeof options.verbose === 'undefined') options.verbose = true;
  if (typeof options.formatting === 'undefined') options.formatting = true;

  const instanceOptions = {
    saxStrict: true,
    saxNormalize: true,
    saxPosition: true,
    saxStrictEntities: true,
    saxTrim: options.saxTrim,
    verbose: options.verbose,
    formatting: options.formatting
  };

  return new XlsxStreamReaderWorkBook(instanceOptions);
}
