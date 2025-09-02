import { byteStreamFromStringParts, ColumnTypes, getNameForCell, isValidSheetName, validateAndFixRowsColumns, type FixedSpreadsheetOptions, type GenerateSpreadsheetOptions, type GenerateWorkbookProperties, type SpreadsheetColumn } from "./support";
import { encodeString, stdTypeOf, stringify, type Money } from "@webhare/std";
import { getXLSXBaseTemplate, type SheetInfo } from "./xslx-template";
import { createArchive } from "@webhare/zip";
import type { ReadableStream } from "node:stream/web";
import { utcToLocal } from "@webhare/hscompat";

export type GenerateXLSXOptions = (GenerateSpreadsheetOptions | GenerateWorkbookProperties) & { timeZone?: string };

function TemporalToExcel(x: Temporal.Instant | Temporal.ZonedDateTime): number {
  return x.epochMilliseconds / 86400_000 + 25569;
}

function dateToExcel(x: Date): number {
  return x.getTime() / 86400_000 + 25569;
}

// Temporal is somewhat heavier than
const useTemporal = false;

class WorksheetBuilder {
  constructor(private doc: XLSXDocBuilder) {
  }

  createHeaderRow(doc: XLSXDocBuilder, sheetSettings: FixedSpreadsheetOptions) {
    let result = '';
    result += `<row r="1">`;
    for (const [idx, col] of sheetSettings.columns.entries()) {
      result += this.renderCell(getNameForCell(idx + 1, 1), col.title, { ...col, type: "string", style: this.calcColumnStyle({ ...col, type: "string" }) }, {});
    }
    result += `</row>`;
    return result;
  }


  renderCell(cellId: string, value: unknown, col: SpreadsheetColumn & { style: number }, options: { timeZone?: string }) {
    let storevalue: string, type = '';
    const typeinfo = ColumnTypes[col.type];
    const valType = stdTypeOf(value);
    if (typeinfo.validDataTypes && !(typeinfo.validDataTypes as string[]).includes(valType)) {
      throw new Error(`Invalid type for column ${col.name}: ${valType} - expect: ${typeinfo.validDataTypes.join(", ")}`);
    }

    switch (col.type) {
      case "string":
        storevalue = this.doc.storeSharedString(String(value));
        type = "s";
        break;
      case "date":
        storevalue = String(Math.floor(dateToExcel((value as Date))));
        type = "";
        break;
      case "dateTime": {
        // The temporal conversion costs about 0.01ms, while utcToLocal costs about 0.004ms, so sticking with that one for now
        if (!useTemporal) {
          storevalue = String(dateToExcel(col.storeUTC ? utcToLocal(value as Date, options.timeZone!) : (value as Date)));
        } else {
          storevalue = col.storeUTC ?
            String(TemporalToExcel((value as Date).toTemporalInstant().toZonedDateTimeISO(options.timeZone!).toPlainDateTime().toZonedDateTime("UTC"))) :
            String(dateToExcel(value as Date));
        }
        type = "";
      } break;
      case "boolean":
        storevalue = value ? "1" : "0";
        type = "b";
        break;
      case "money":
        storevalue = (value as Money).format({ decimalSeparator: "." });
        break;
      case "number":
        storevalue = String(value);
        break;
      case "time":
        storevalue = String(value as number / 86400_000);
        break;
      default:
        //@ts-expect-error -- we should have covered all cases, so col.type === never
        throw new Error(`Unimplemented column type: ${col.type}`);
    }

    let result = `<c r="${cellId}"`;
    if (col.style)
      result += ` s="${col.style}"`;
    if (type)
      result += ` t="${type}"`;

    storevalue = encodeString(storevalue, 'attribute');
    if (type === 'inlineStr')
      result += `><is><t>${storevalue}</t></is></c>`;
    else
      result += `><v>${storevalue}</v></c>`;

    return result;
  }

  calcColumnStyle(column: SpreadsheetColumn): number {
    const fmt: Omit<CellFormat, "seqNr"> = {};
    if (column.align)
      fmt.align = column.align;

    switch (column.type) {
      case "date": {
        fmt.numFmtId = this.doc.dateNumFormat;
      } break;
      case "dateTime": {
        fmt.numFmtId = this.doc.dateTimeNumFormat;
      } break;
      case "time": {
        fmt.numFmtId = this.doc.timeNumFormat;
      } break;
      case "number": {
        if (column.decimals !== undefined)
          fmt.numFmtId = this.doc.setNumberFormat("0." + "0".repeat(column.decimals));
      } break;
    }

    return this.doc.setCellFormat(fmt);
  }

  calcColumnStyles(columns: SpreadsheetColumn[]): Array<SpreadsheetColumn & { style: number }> {
    return columns.map(col => ({ ...col, style: this.calcColumnStyle(col) }));
  }

  * createRows(sheetSettings: FixedSpreadsheetOptions, options: { timeZone?: string }) {
    let currow = 1;

    //Create header row
    yield this.createHeaderRow(this.doc, sheetSettings);
    ++currow;

    const cols = this.calcColumnStyles(sheetSettings.columns).entries().toArray();
    for (const row of sheetSettings.rows) {
      let result = `<row r="${currow}">`;
      for (const [idx, col] of cols) {
        const value = row[col.name];
        if (value === null || value === undefined)
          continue;

        const cellId = getNameForCell(idx + 1, currow);
        result += this.renderCell(cellId, value, col, options);
      }

      result += `</row>`;
      yield result;
      ++currow;
    }
  }
}

type CellFormat = {
  seqNr: number;
  numFmtId?: number;
  align?: "general" | "left" | "center" | "right";
};

type NumberFormat = {
  //seqNr: number;
  numFmtId: number;
  formatCode: string;
};

export class XLSXDocBuilder {
  nextFormatSeq = 1;
  nextNumberFormatId = 165;
  formats = new Array<CellFormat>;
  formatMap = new Map<string, CellFormat>;
  numberFormats = new Array<NumberFormat>;
  numberFormatMap = new Map<string, NumberFormat>;
  dateNumFormat = this.setNumberFormat("d mmm yyyy;@");
  timeNumFormat = this.setNumberFormat("h:mm:ss;@");
  dateTimeNumFormat = this.setNumberFormat("d mmm yyyy h:mm:ss;@");

  sharedString: string[] = [];
  sharedStringMap = new Map<string, number>();

  constructor() {
    this.formatMap.set("{}", { seqNr: 0 });
  }

  setCellFormat(format: Omit<CellFormat, "seqNr">): number {
    const hash = stringify(format, { stable: true });
    let fmt = this.formatMap.get(hash);
    if (!fmt) {
      fmt = { seqNr: this.nextFormatSeq++, ...format };
      this.formats.push(fmt);
      this.formatMap.set(hash, fmt);
    }
    return fmt.seqNr;
  }

  setNumberFormat(formatCode: string): number {
    let numFormat = this.numberFormatMap.get(formatCode);
    if (!numFormat) {
      numFormat = { numFmtId: this.nextNumberFormatId++, formatCode };
      this.numberFormats.push(numFormat);
      this.numberFormatMap.set(formatCode, numFormat);
    }
    return numFormat.numFmtId;
  }

  storeSharedString(toStore: string): string {
    let pos = this.sharedStringMap.get(toStore);
    if (!pos) {
      pos = this.sharedString.length;
      this.sharedString.push(toStore);
      this.sharedStringMap.set(toStore, pos);
    }
    return String(pos);
  }
}

function createSheet(doc: XLSXDocBuilder, sheetSettings: FixedSpreadsheetOptions, tabSelected: boolean, options: { timeZone?: string }): ReadableStream<Uint8Array> {
  const builder = new WorksheetBuilder(doc);
  const rows = builder.createRows(sheetSettings, options);
  const dimensions = getNameForCell(sheetSettings.columns.length || 1, sheetSettings.rows.length + 1);
  let preamble = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n`;
  preamble += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{00000000-0001-0000-0000-000000000000}">`;
  preamble += `<dimension ref="A1:${dimensions}"/>`;
  preamble += `<sheetViews><sheetView ${tabSelected ? `tabSelected="1"` : ""} workbookViewId="0">`;
  if (sheetSettings.split?.columns || sheetSettings.split?.rows)
    preamble += `<pane xSplit="${sheetSettings.split?.columns ?? 0}" ySplit="${sheetSettings.split?.rows ?? 0}" state="frozenSplit" topLeftCell="${getNameForCell((sheetSettings.split?.columns ?? 0) + 1, (sheetSettings.split?.rows ?? 0) + 1)}" />`;
  preamble += `</sheetView></sheetViews>`;
  preamble += `<sheetFormatPr baseColWidth="10" defaultRowHeight="16" x14ac:dyDescent="0.2"/>`;

  const colDefs = [];
  for (const [idx, col] of sheetSettings.columns.entries()) {
    let width: number | undefined;
    // Adjust default widths for dateTime & numbers with decimals
    if (col.type === "dateTime")
      width = 18;
    if (col.type === "number" && col.decimals !== undefined)
      width = 7 + col.decimals; // contains 6 decimals + '.' + col.decimals (tested up to 10 decimals)
    if (width !== undefined)
      colDefs.push(`<col min="${idx + 1}" max="${idx + 1}" bestFit="1" width="${width}"/>`);
  }

  if (colDefs.length) //<xsd:element name="col" type="CT_Col" minOccurs="1" maxOccurs="unbounded"/> - so only output <cols> if we have at least 1
    preamble += `<cols>${colDefs.join("")}</cols>`;

  preamble += `<sheetData>`;
  let postamble = `</sheetData>`;
  if (sheetSettings.withAutoFilter) {
    postamble += `<autoFilter ref="A1:${dimensions}"/>`;
  }
  postamble += `<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><extLst><ext uri="{64002731-A6B0-56B0-2670-7721B7C09600}" xmlns:mx="http://schemas.microsoft.com/office/mac/excel/2008/main"><mx:PLV Mode="0" OnePage="0" WScale="0"/></ext></extLst></worksheet>`;

  return byteStreamFromStringParts([
    preamble,
    rows,
    postamble
  ]);
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
      const sheetinfo: SheetInfo[] = [];
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
        const outputSheet = createSheet(xlsxdoc, sheet, idx === 0, options);
        await controller.addFile(`xl/worksheets/${sheetname}`, outputSheet, new Date);
        sheetinfo.push({
          name: sheetname,
          title: useTitle,
          fixedDimensions: `${getNameForCell(sheet.columns.length || 1, sheet.rows.length + 1, { fixedColumn: true, fixedRow: true })}`,
          withAutoFilter: sheet.withAutoFilter,
        });
      }

      //Create the workbook
      for (const [fullpath, data] of Object.entries(getXLSXBaseTemplate(xlsxdoc, sheetinfo))) {
        if (typeof data === "string") {
          await controller.addFile(fullpath, data, new Date);
        } else {
          const stream = byteStreamFromStringParts(data);
          await controller.addFile(fullpath, stream, new Date);
        }
      }
    },
  });

  // XLSX files are small enough to be kept in memory
  const buffers = new Array<Uint8Array>();
  for await (const chunk of archive)
    buffers.push(chunk);

  return new File(buffers, `${options?.title || "export"}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
