// @webhare/cli: Convert between some file formats

import { CLIRuntimeError, run } from "@webhare/cli";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { slugify } from "@webhare/std";
import { storeDiskFile } from "@webhare/system-tools";
import { readFileSync } from "node:fs";

async function getXLSXRows(path: string): Promise<string[][]> {
  const xlsxin = await loadlib("mod::system/whlibs/ooxml/spreadsheet.whlib").OpenOOXMLSpreadSheetFile(WebHareBlob.from(readFileSync(path)));
  const xlssheet = await xlsxin.OpenSheet(0);
  const outrows = await xlssheet.GetAllRows({ processheaders: true });
  return outrows;
}

run({
  description: "",
  flags: {
    "v,verbose": "Show more info",
  },
  arguments: [
    { name: "<source>" },
    { name: "<sink>" },
  ],
  main: async function main({ opts, args }) {
    if (!args.source.endsWith(".xlsx") || !args.sink.endsWith(".json"))
      throw new CLIRuntimeError("Only xlsx->json currently supported");

    const rows = await getXLSXRows(args.source); //TODO a --no-headers option
    const headers = new Array<string>;

    //setup unique names
    for (const hdr of rows[0]) {
      const baseheader = slugify(hdr, { separator: "_" }) || "col";

      for (let num = 1; ; ++num) {
        const tryname = num === 1 ? baseheader : `${baseheader}_${num}`;
        if (!headers.includes(tryname)) {
          headers.push(tryname);
          break;
        }
      }
    }

    const outrows: Array<Record<string, unknown>> = [];
    for (const row of rows.slice(1)) {
      const outrow: Record<string, unknown> = {};
      for (const [idx, cell] of row.entries()) {
        outrow[headers[idx]] = cell;
      }
      outrows.push(outrow);
    }

    await storeDiskFile(args.sink, JSON.stringify(outrows) + '\n', { overwrite: false });
  }
});
