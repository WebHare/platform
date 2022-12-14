import * as stacktrace_parser from "stacktrace-parser";
import * as fs from "node:fs";

export function reportAssertError(stack: string) {
  const badline = stacktrace_parser.parse(stack)[1];
  if(badline?.file && badline.lineNumber) {
    console.log(`test.assert failed in ${badline.file.split('/').slice(-1)[0]} line ${badline.lineNumber}`);

    const contents = fs.readFileSync(badline.file).toString().split("\n")[badline.lineNumber - 1];
    console.log(`Offending test: ${contents.trim()}`);
  }
}