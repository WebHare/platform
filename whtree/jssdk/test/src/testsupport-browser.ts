import * as stacktrace_parser from "stacktrace-parser";

export function reportAssertError(stack: string)
{
  //TODO we should probably async-schedule a stacktrace parse and report the sourcemapped location. for now we simply exist to have 'a' testsupport implementation for the browser and preventing node:fs deps
  const badline = stacktrace_parser.parse(stack)[1];
  if(badline?.file && badline.lineNumber) {
    console.log(`test.assert failed in ${badline.file.split('/').slice(-1)[0]} line ${badline.lineNumber}`);
  }
}