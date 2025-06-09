import { ColumnTypes, isValidSheetName, validateAndFixRowsColumns, type FixedSpreadsheetOptions, type GenerateSpreadsheetOptions, type GenerateWorkbookProperties, type SpreadsheetColumn } from "./support";
import { encodeString, stdTypeOf, type Money } from "@webhare/std";
import { getXLSXBaseTemplate, type SheetInfo } from "./xslx-template";
import { createArchive } from "@webhare/zip";
import { ReadableStream } from "node:stream/web";

export type GenerateXLSXOptions = (GenerateSpreadsheetOptions | GenerateWorkbookProperties) & { timeZone?: string };

//get name for column, 1-based
function getNameForCell(col: number, row: number): string {
  if (col < 1 || row < 1)
    throw new Error(`Invalid column or row number: col=${col}, row=${row}`);
  let name = "";
  col -= 1;
  while (true) {
    name = String.fromCharCode(65 + col % 26) + name;
    if (col < 26)
      break;
    col = (col - 26) / 26;
  }
  return name + row;
}

function createHeaderRow(sheetSettings: FixedSpreadsheetOptions) {
  let result = '';
  result += `<row r="1">`;
  for (const [idx, col] of sheetSettings.columns.entries()) {
    result += `<c r="${getNameForCell(idx + 1, 1)}" t="inlineStr"><is><t>${encodeString(col.title, 'attribute')}</t></is></c>`;
  }
  result += `</row>`;
  return result;
}

function dateToExcel(x: Date) {
  return x.getTime() / 86400_000 + 25569;
}

class WorksheetBuilder {
  constructor(private doc: XLSXDocBuilder) {
  }

  renderCell(cellId: string, value: unknown, col: SpreadsheetColumn) {
    let storevalue: string, type = '', style = 0;
    const typeinfo = ColumnTypes[col.type];
    const valType = stdTypeOf(value);
    if (typeinfo.validDataTypes && !(typeinfo.validDataTypes as string[]).includes(valType)) {
      throw new Error(`Invalid type for column ${col.name}: ${valType} - expect: ${typeinfo.validDataTypes.join(", ")}`);
    }

    switch (col.type) {
      case "string":
        storevalue = String(value);
        type = "inlineStr";
        break;
      case "date":
        storevalue = String(Math.floor(dateToExcel(value as Date)));
        type = "";
        style = this.doc.dateFormat;
        break;
      case "dateTime":
        storevalue = String(dateToExcel(value as Date));
        type = "";
        style = this.doc.dateTimeFormat;
        break;
      case "boolean":
        storevalue = value ? "1" : "0";
        type = "b";
        break;
      case "money":
        storevalue = (value as Money).format({ decimalSeparator: "." });
        break;
      case "number":
        storevalue = String(value);
        if (col.decimals !== undefined) {
          style = this.doc.setNumberFormat("0." + "0".repeat(col.decimals));
        }
        break;
      case "time":
        storevalue = String(value as number / 86400_000);
        style = this.doc.timeFormat;
        break;
      default:
        //@ts-expect-error -- we should have covered all cases, so col.type === never
        throw new Error(`Unimplemented column type: ${col.type}`);
    }

    let result = `<c r="${cellId}"`;
    if (style)
      result += ` s="${style}"`;
    if (type)
      result += ` t="${type}"`;

    storevalue = encodeString(storevalue.replaceAll('\n', '\r'), 'attribute');
    if (type === 'inlineStr')
      result += `><is><t>${storevalue}</t></is></c>`;
    else
      result += `><v>${storevalue}</v></c>`;

    return result;
  }

  *createRows(sheetSettings: FixedSpreadsheetOptions) {
    let currow = 1;

    //Create header row
    yield createHeaderRow(sheetSettings);
    ++currow;

    const cols = [...sheetSettings.columns.entries()];
    for (const row of sheetSettings.rows) {
      let result = `<row r="${currow}">`;
      for (const [idx, col] of cols) {
        const value = row[col.name];
        if (value === null || value === undefined)
          continue;

        const cellId = getNameForCell(idx + 1, currow);
        result += this.renderCell(cellId, value, col);
      }

      result += `</row>`;
      yield result;
      ++currow;
    }
  }
}

type NumberFormat = {
  seqNr: number;
  numFmtId: number;
  formatCode: string;
};

export class XLSXDocBuilder {
  nextFormatId = 165;
  nextFormatSeq = 1;
  formats = new Array<NumberFormat>;
  formatMap = new Map<string, NumberFormat>;
  dateFormat = this.setNumberFormat("d mmm yyyy;@");
  timeFormat = this.setNumberFormat("h:mm:ss;@");
  dateTimeFormat = this.setNumberFormat("d mmm yyyy h:mm:ss;@");

  constructor() {

  }

  setNumberFormat(formatCode: string): number {
    const match = this.formatMap.get(formatCode);
    if (match)
      return match.seqNr;

    const numFmtId = this.nextFormatId++;
    const seqNr = this.nextFormatSeq++;
    const format = { seqNr, numFmtId, formatCode };
    this.formats.push(format);
    this.formatMap.set(formatCode, format);
    return seqNr;
  }
}

function createSheet(doc: XLSXDocBuilder, sheetSettings: FixedSpreadsheetOptions, tabSelected: boolean): ReadableStream {
  const builder = new WorksheetBuilder(doc);
  const rows = builder.createRows(sheetSettings);
  const dimensions = getNameForCell(sheetSettings.columns.length || 1, sheetSettings.rows.length + 1);
  let preamble = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n`;
  preamble += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{00000000-0001-0000-0000-000000000000}">`;
  preamble += `<dimension ref="A1:${dimensions}"/>`;
  preamble += `<sheetViews><sheetView ${tabSelected ? `tabSelected="1"` : ""} workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="16" x14ac:dyDescent="0.2"/><sheetData>`;
  let postample = `</sheetData>`;
  postample += `<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><extLst><ext uri="{64002731-A6B0-56B0-2670-7721B7C09600}" xmlns:mx="http://schemas.microsoft.com/office/mac/excel/2008/main"><mx:PLV Mode="0" OnePage="0" WScale="0"/></ext></extLst></worksheet>`;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(preamble));
    },
    pull(controller) {
      const { done, value } = rows.next();
      if (done) {
        controller.enqueue(new TextEncoder().encode(postample));
        controller.close();
      } else {
        controller.enqueue(new TextEncoder().encode(value));
      }
    },
  });
}

/** Generate a XLSX file
    @returns Blob blob containing the XLSX file
*/
export async function generateXLSX(options: GenerateXLSXOptions): Promise<File> {
  const inSheets = "sheets" in options ? options.sheets : [options];
  const sheets = inSheets.map(sheet => validateAndFixRowsColumns({ timeZone: options.timeZone, ...sheet }));

  const archive = createArchive({
    async build(controller) {

      //Create the worksheets
      const sheetnames: SheetInfo[] = [];
      const names = new Set<string>;
      const xlsxdoc = new XLSXDocBuilder;

      for (const [idx, sheet] of sheets.entries()) {
        const useTitle = sheet.title ?? `Sheet${idx + 1}`;
        if (!isValidSheetName(useTitle)) //TOOD merge into validateRowsColumns ? but it would also need to take over assigning titles then
          throw new Error(`Invalid sheet name: ${useTitle}`);

        if (names.has(useTitle.toLowerCase()))
          throw new Error(`Duplicate sheet name: ${useTitle}`);

        names.add(useTitle.toLowerCase());

        const sheetname = `sheet${idx + 1}.xml`;
        const outputSheet = createSheet(xlsxdoc, sheet, idx === 0);
        await controller.addFile(`xl/worksheets/${sheetname}`, outputSheet, new Date);
        sheetnames.push({ name: sheetname, title: useTitle });
      }

      //Create the workbook
      for (const [fullpath, data] of Object.entries(getXLSXBaseTemplate(xlsxdoc, sheetnames))) {
        await controller.addFile(fullpath, data, new Date);
      }
    },
  });

  // XLSX files are small enough to be kept in memory
  const buffers = new Array<Uint8Array>();
  for await (const chunk of archive)
    buffers.push(chunk);

  return new File(buffers, `${options?.title || "export"}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
