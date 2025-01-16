import { ColumnTypes, validateRowsColumns, type GenerateSpreadsheetOptions, type GenerateWorkbookProperties, type SpreadsheetColumn } from "./support";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { encodeString, stdTypeOf, type Money } from "@webhare/std";
import { getXLSXBaseTemplate, type SheetInfo } from "./xslx-template";

export type GenerateXLSXOptions = (GenerateSpreadsheetOptions | GenerateWorkbookProperties) & { timeZone?: string };

//get name for column, 1-based
function getNameForColumn(col: number): string {
  let name = "";
  col -= 1;
  while (true) {
    name = String.fromCharCode(65 + col % 26) + name;
    if (col < 26)
      break;
    col = (col - 26) / 26;
  }
  return name;
}

function createHeaderRow(sheetSettings: GenerateSpreadsheetOptions) {
  let result = '';
  result += `<row r="1">`;
  for (const [idx, col] of sheetSettings.columns.entries()) {
    result += `<c r="${getNameForColumn(idx + 1)}1" t="inlineStr"><is><t>${encodeString(col.title, 'attribute')}</t></is></c>`;
  }
  result += `</row>`;
  return result;
}

function dateToExcel(x: Date) {
  return x.getTime() / 86400_000 + 25569;
}

class WorksheetBuilder {
  renderCell(cellId: string, value: unknown, col: SpreadsheetColumn) {
    let storevalue: string, type = '', style = 0;
    const typeinfo = ColumnTypes[col.type];
    const valType = stdTypeOf(value);
    if (!(typeinfo.validDataTypes as string[]).includes(valType)) {
      throw new Error(`Invalid type for column ${col.name}: ${valType} - expect: ${typeinfo.validDataTypes.join(", ")}`);
    }

    switch (col.type) {
      case "string":
        storevalue = value as string;
        type = "inlineStr";
        break;
      case "date":
        storevalue = String(Math.floor(dateToExcel(value as Date)));
        type = "";
        style = 1; //format 165: d mmm yyyy
        break;
      case "dateTime":
        storevalue = String(dateToExcel(value as Date));
        type = "";
        style = 3; //format 167: d mmm yyyy h:mm:ss
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
        break;
      case "time":
        storevalue = String(value as number / 86400_000);
        style = 2; //format 166: h:mm:ss
        break;
      default:
        //@ts-expect-error -- we should have covered all cases, so col.type === never
        throw new Error(`Unimplemented column type: ${col.type}`);
    }

    let result = `<c r="${cellId}"`;
    if (style)
      result += ` s="${style}"`;
    if (type)
      result += ` t = "${type}"`;

    storevalue = encodeString(storevalue.replaceAll('\n', '\r'), 'attribute');
    if (type === 'inlineStr')
      result += `><is><t>${storevalue}</t></is></c>`;
    else
      result += `><v>${storevalue}</v></c>`;

    return result;
  }

  createRows(sheetSettings: GenerateSpreadsheetOptions) {
    let currow = 1;
    const rows: string[] = [];

    //Create header row
    rows.push(createHeaderRow(sheetSettings));
    ++currow;

    const cols = [...sheetSettings.columns.entries()];
    for (const row of sheetSettings.rows) {
      let result = `<row r="${currow}">`;
      for (const [idx, col] of cols) {
        const value = row[col.name];
        if (value === null || value === undefined)
          continue;

        const cellId = getNameForColumn(idx + 1) + currow;
        result += this.renderCell(cellId, value, col);
      }

      result += `</row>`;
      rows.push(result);
      ++currow;
    }
    return rows;
  }
}

function createSheet(sheetSettings: GenerateSpreadsheetOptions, tabSelected: boolean) {
  const builder = new WorksheetBuilder;
  const rows = builder.createRows(sheetSettings);
  const dimensions = getNameForColumn(sheetSettings.columns.length) + rows.length;
  let result = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n`;
  result += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{00000000-0001-0000-0000-000000000000}">`;
  result += `<dimension ref="A1:${dimensions}"/>`;
  result += `<sheetViews><sheetView ${tabSelected ? `tabSelected="1"` : ""} workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="16" x14ac:dyDescent="0.2"/><sheetData>`;
  result += rows.join('');
  result += `</sheetData>`;
  result += `<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/><extLst><ext uri="{64002731-A6B0-56B0-2670-7721B7C09600}" xmlns:mx="http://schemas.microsoft.com/office/mac/excel/2008/main"><mx:PLV Mode="0" OnePage="0" WScale="0"/></ext></extLst></worksheet>`;

  return result;
}

/** Generate a XLSX file
    @returns Blob blob containing the XLSX file
*/
export async function generateXLSX(options: GenerateXLSXOptions): Promise<File> {
  const sheets = "sheets" in options ? options.sheets : [options];
  for (const sheet of sheets)
    validateRowsColumns({ timeZone: options.timeZone, ...sheet });

  //Create the worksheets
  const sheetnames: SheetInfo[] = [];
  const output = await loadlib("mod::system/whlibs/filetypes/archiving.whlib").CreateNewArchive("zip");
  for (const [idx, sheet] of sheets.entries()) {
    const sheetname = `sheet${idx + 1}.xml`;
    const outputSheet = createSheet(sheet, idx === 0);
    await output.AddFile(`xl/worksheets/${sheetname}`, WebHareBlob.from(outputSheet), new Date);
    sheetnames.push({ name: sheetname, title: sheet.title ?? `Sheet${idx + 1}` });
  }

  //Create the workbook
  for (const [fullpath, data] of Object.entries(getXLSXBaseTemplate(sheetnames))) {
    await output.AddFile(fullpath, WebHareBlob.from(data), new Date);
  }

  const outblob = await output.MakeBlob() as WebHareBlob;
  return new File([await outblob.arrayBuffer()], `${options?.title || "export"}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
