import { createArchive } from "@webhare/zip";
import { byteStreamFromStringParts, ColumnTypes, getNameForCell, omitUndefined, validateAndFixRowsColumns, type FixedSpreadsheetOptions, type SpreadsheetData, type WorkbookData, type SpreadsheetColumn, shouldShowCell } from "./support";
import { encodeString, pick, stdTypeOf, stringify, type Money } from "@webhare/std";
import type { ReadableStream } from "node:stream/web";


/* To further improve styling read https://docs.oasis-open.org/office/v1.2/cd05/OpenDocument-v1.2-cd05-part1.html or
   - Create an ODS document with better styling, unzip it and reformat/open content.xml and styles.xml to get a practical styling definition
   - Copy and clean the style into <office:automatic-styles> below
   - Specialize the <table:table-column line to point to an automatic-styles style based on the column's settings
*/

//TODO create only the number decimal styles we actually need
const contentPreamble = (builder: ODSBuilder) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:css3t="http://www.w3.org/TR/css3-text/" xmlns:grddl="http://www.w3.org/2003/g/data-view#" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xforms="http://www.w3.org/2002/xforms" xmlns:dom="http://www.w3.org/2001/xml-events" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" xmlns:form="urn:oasis:names:tc:opendocument:xmlns:form:1.0" xmlns:math="http://www.w3.org/1998/Math/MathML" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:field="urn:openoffice:names:experimental:ooo-ms-interop:xmlns:field:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:formx="urn:openoffice:names:experimental:ooxml-odf-interop:xmlns:form:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:rpt="http://openoffice.org/2005/report" xmlns:dr3d="urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0" xmlns:tableooo="http://openoffice.org/2009/table" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0" xmlns:oooc="http://openoffice.org/2004/calc" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:drawooo="http://openoffice.org/2010/draw" xmlns:ooow="http://openoffice.org/2004/writer" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:ooo="http://openoffice.org/2004/office" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.4">
  <office:automatic-styles>
    <style:style style:name="co1" style:family="table-column">
      <style:table-column-properties fo:break-before="auto" style:column-width="0.889in"/>
    </style:style>
    <style:style style:name="ro1" style:family="table-row">
      <style:table-row-properties style:row-height="0.178in" fo:break-before="auto" style:use-optimal-row-height="true"/>
    </style:style>
    <style:style style:name="ro2" style:family="table-row">
      <style:table-row-properties style:row-height="0.3335in" fo:break-before="auto" style:use-optimal-row-height="true"/>
    </style:style>
    <number:date-style style:name="wh_date" number:automatic-order="true">
      <number:month number:style="long"/>
      <number:text>/</number:text>
      <number:day number:style="long"/>
      <number:text>/</number:text>
      <number:year/>
    </number:date-style>
    <number:date-style style:name="wh_datetime" number:automatic-order="true" number:format-source="language">
      <number:month/>
      <number:text>/</number:text>
      <number:day/>
      <number:text>/</number:text>
      <number:year/>
      <number:text> </number:text>
      <number:hours number:style="long"/>
      <number:text>:</number:text>
      <number:minutes number:style="long"/>
      <number:text> </number:text>
      <number:am-pm/>
    </number:date-style>
    <number:time-style style:name="wh_time">
      <number:hours number:style="long"/>
      <number:text>:</number:text>
      <number:minutes number:style="long"/>
      <number:text>:</number:text>
      <number:seconds number:style="long"/>
      <number:text> </number:text>
      <number:am-pm/>
    </number:time-style>
${builder.constructStyleNodes()}
  </office:automatic-styles>
  <office:body>
    <office:spreadsheet>`;

const contentPostamble = `</office:spreadsheet>
  </office:body>
</office:document-content>`;

const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  xmlns:css3t="http://www.w3.org/TR/css3-text/" xmlns:grddl="http://www.w3.org/2003/g/data-view#"
  xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:dom="http://www.w3.org/2001/xml-events"
  xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0"
  xmlns:form="urn:oasis:names:tc:opendocument:xmlns:form:1.0"
  xmlns:math="http://www.w3.org/1998/Math/MathML"
  xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
  xmlns:field="urn:openoffice:names:experimental:ooo-ms-interop:xmlns:field:1.0"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
  xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:rpt="http://openoffice.org/2005/report"
  xmlns:dr3d="urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0"
  xmlns:tableooo="http://openoffice.org/2009/table"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
  xmlns:oooc="http://openoffice.org/2004/calc" xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:drawooo="http://openoffice.org/2010/draw" xmlns:ooow="http://openoffice.org/2004/writer"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:ooo="http://openoffice.org/2004/office"
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.4">

</office:document-styles>
`;

const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.4" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.4" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

type Style = {
  align?: "start" | "center" | "end";
  dataStyleName?: string;
};

type DataStyle = ({
  type: "number";
  decimals?: number;
});

type ColumnStyle = ({
  width?: number;
});

class StyleKeeper<T extends object> {
  prefix: string;
  counter = 0;
  list: Array<T & { name: string }> = [];
  map = new Map<string, T & { name: string }>;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  get(rec: T): string {
    const hash = stringify(rec, { stable: true });
    let existing = this.map.get(hash);
    if (!existing) {
      existing = {
        name: `${this.prefix}${++this.counter}`,
        ...rec
      };
      this.list.push(existing);
      this.map.set(hash, existing);
    }
    return existing.name;
  }
}

class ODSBuilder {
  style = new StyleKeeper<Style>("ce");
  dataStyle = new StyleKeeper<DataStyle>("da");
  columnStyle = new StyleKeeper<ColumnStyle>("co");

  constructor() {
    this.style.map.set("{}", { name: "Default" });
    this.columnStyle.map.set("{}", { name: "Default" });
  }

  getStyle(style: Omit<Style, "name">): string {
    return this.style.get(style);
  }

  getNumberStyle(dataStyle: Omit<DataStyle, "name">): string {
    return this.dataStyle.get(dataStyle);
  }

  getColumnStyle(columnStyle: Omit<ColumnStyle, "name">): string {
    return this.columnStyle.get(columnStyle);
  }
  constructStyleNodes() {
    return [
      ...this.dataStyle.list.map((style) => {
        switch (style.type) {
          case "number": return (
            `  <number:number-style style:name="${style.name}">\n` +
            `    <number:number${style.decimals ? ` number:decimal-places="${style.decimals}" number:min-decimal-places="${style.decimals}"` : ""} number:min-integer-digits="1"/>\n` +
            `  </number:number-style>`);
        }
      }),
      ...this.style.list.map((style) =>
        `   <style:style style:name="${style.name}" style:family="table-cell" style:parent-style-name="Default"${style.dataStyleName ? ` style:data-style-name="${style.dataStyleName}"` : ''}>\n` +
        (style.align ? `      <style:table-cell-properties style:text-align-source="fix" style:repeat-content="false"/>\n` +
          `      <style:paragraph-properties fo:text-align="${style.align}"/>\n` : '') +
        `   </style:style>`),
      ...this.columnStyle.list.map((style) =>
        `   <style:style style:name="${style.name}" style:family="table-column">\n` +
        `     <style:table-column-properties fo:break-before="auto"${style.width ? ` style:column-width="${style.width.toFixed(4)}in"` : ``}/>\n` +
        `   </style:style>`),
    ].join('\n');
  }
}

function renderCell(value: unknown, col: SpreadsheetColumn & { style: string }, options: { timeZone?: string }) {
  const typeinfo = ColumnTypes[col.type];
  const valType = stdTypeOf(value);

  if (typeinfo.validDataTypes && !(typeinfo.validDataTypes as string[]).includes(valType)) {
    throw new Error(`Invalid type for column ${col.name}: ${valType} - expect: ${typeinfo.validDataTypes.join(", ")}`);
  }

  const styleAttr = col.style ? ` table:style-name="${col.style}"` : "";

  switch (col.type) {
    case "string":
      return `<table:table-cell office:value-type="string"${styleAttr}>${(value as string).split("\n").map(line => `<text:p>${encodeString(line, 'attribute')}</text:p>`).join("")}</table:table-cell>`;
    case "date": {
      const isovalue = (value as Date).toISOString().split("T")[0];
      return `<table:table-cell office:value-type="date" office:date-value="${isovalue}"${styleAttr}><text:p>${isovalue}</text:p></table:table-cell>`;
    }
    case "dateTime": {
      const isovalue = (col.storeUTC ?
        (value as Date).toTemporalInstant().toZonedDateTimeISO(options.timeZone!).toPlainDateTime().toString() :
        (value as Date).toISOString()).replace("Z", "");

      // Text will be rerendered, so no need to correctly format it
      return `<table:table-cell office:value-type="date" office:date-value="${isovalue}"${styleAttr}><text:p>${isovalue}</text:p></table:table-cell>`;
    }
    case "boolean": {
      const attrvalue = value ? "true" : "false";
      return `<table:table-cell office:value-type="boolean" office:boolean-value="${attrvalue}"${styleAttr}><text:p>${attrvalue.toUpperCase()}</text:p></table:table-cell>`;
    }
    case "money": {
      const storevalue = (value as Money).format({ decimalSeparator: "." });
      return `<table:table-cell office:value-type="float" office:value="${storevalue}"${styleAttr}><text:p>${storevalue}</text:p></table:table-cell>`;
    }
    case "number": {
      //TODO if (col.decimals !== undefined) {        style = this.doc.setNumberFormat("0." + "0".repeat(col.decimals)); }
      const storevalue = String(value);
      return `<table:table-cell office:value-type="float" office:value="${storevalue}"${styleAttr}><text:p>${storevalue}</text:p></table:table-cell>`;
    }
    case "time": {
      //TODO Format the text:p value as time, eg 12:00 PM ?
      const storevalue = Temporal.Duration.from({ milliseconds: value as number }).toString();
      return `<table:table-cell office:value-type="float" office:time-value="${storevalue}"${styleAttr}><text:p>${storevalue}</text:p></table:table-cell>`;
    }
    default:
      //@ts-expect-error -- we should have covered all cases, so col.type === never
      throw new Error(`Unimplemented column type: ${col.type} `);
  }
}

function createHeaderRow(cols: SpreadsheetColumn[]) {
  let result = `<table:table-row>`;
  for (const [idx, col] of cols.entries())
    result += renderCell(col.title, { name: "header", title: "Header " + (idx + 1), type: "string", style: "Default" }, {});

  result += `</table:table-row>`;
  return result;
}

function createRow(row: Record<string, unknown>, cols: Array<SpreadsheetColumn & { style: string }>, options: { timeZone?: string }) {
  let result = `<table:table-row>`;
  for (const col of cols) {
    const value = row[col.name];
    if (!shouldShowCell(value)) {
      result += `<table:table-cell/>`;
      continue;
    }

    result += renderCell(value, col, options);
  }
  result += `</table:table-row>`;
  return result;
}

type SheetsWithStyle = Array<FixedSpreadsheetOptions & { columns: Array<FixedSpreadsheetOptions["columns"][number] & { style: string; columnStyle: string }> }>;

function calcColumnStyles(builder: ODSBuilder, sheets: FixedSpreadsheetOptions[]): SheetsWithStyle {
  /* Style with is in inches, measured by generating a .xlsx, opening in LibreOffice and saving as .ods
     default: 0.8811in
     xlsx width 10: 0.8465in
     xlsx width 18: 1.5236in
  */
  const charWidth = 0.0846375; // (1.5236-0.8654)/8

  return sheets.map(sheet => ({
    ...sheet,
    columns: sheet.columns.map(col => {
      const style: Style = {};
      const columnStyle: ColumnStyle = {};
      //TODO take col.width and translate to ods sizes if set
      if (col.align)
        style.align = ({ left: "start", right: "end", center: "center" } as const)[col.align];
      switch (col.type) {
        case "date": {
          style.dataStyleName = "wh_date";
        } break;
        case "dateTime": {
          style.dataStyleName = "wh_datetime";
          columnStyle.width ??= 18 * charWidth;
        } break;
        case "time": {
          style.dataStyleName = "wh_time";
        } break;
        case "number": {
          style.dataStyleName = builder.getNumberStyle({ type: "number", decimals: col.decimals });
          if (col.decimals)
            columnStyle.width ??= (7 + col.decimals) * charWidth;
        } break;
      }
      columnStyle.width ??= 0.8811; // default, measured by generating xlsx, opening in LibreOffice and saving as .ods
      return { ...col, style: builder.getStyle(style), columnStyle: builder.getColumnStyle(columnStyle) };
    })
  }));
}

function* createSheets(builder: ODSBuilder, sheets: SheetsWithStyle, options: { timeZone?: string }) {
  for (const [idx, sheet] of sheets.entries()) {
    const sheetOptions = {
      ...options,
      ...omitUndefined(pick(sheet, ["timeZone"]))
    };
    yield `<table:table table:name="${encodeString(sheet.title || ('Sheet' + (idx + 1)), 'attribute')}">`;
    for (const col of sheet.columns)
      yield `<table:table-column table:style-name="${col.columnStyle}" />`;
    yield createHeaderRow(sheet.columns);
    for (const row of sheet.rows)
      yield createRow(row, sheet.columns, sheetOptions);
    yield `</table:table>\n`;
  }
  yield `    <table:database-ranges>\n`;
  for (const [idx, sheet] of sheets.entries()) {
    if (sheet.withAutoFilter) {
      const encodedSheetName = encodeString(sheet.title || ('Sheet' + (idx + 1)), 'attribute');
      yield `      <table:database-range table:name="__Anonymous_Sheet_DB__${idx}" table:target-range-address="${encodedSheetName}.A1:${encodedSheetName}.${getNameForCell(sheet.columns.length, sheet.rows.length + 1)}" table:display-filter-buttons="true"/>\n`;
    }
  }
  yield `    </table:database-ranges>\n`;
}

function createSettings(sheets: FixedSpreadsheetOptions[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-settings xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ooo="http://openoffice.org/2004/office" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">
  <office:settings>
    <config:config-item-set config:name="ooo:view-settings">
      <config:config-item-map-indexed config:name="Views">
        <config:config-item-map-entry>
          <config:config-item config:name="ViewId" config:type="string">view1</config:config-item>
          <config:config-item-map-named config:name="Tables">
${sheets.map((sheet, idx) =>
    `            <config:config-item-map-entry config:name="${encodeString(sheet.title || ('Sheet' + (idx + 1)), 'attribute')}">
${sheet.split?.columns ? `              <config:config-item config:name="CursorPositionX" config:type="int">${sheet.split.columns}</config:config-item>
              <config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item>
              <config:config-item config:name="HorizontalSplitPosition" config:type="int">${sheet.split.columns}</config:config-item>
              <config:config-item config:name="PositionRight" config:type="int">${sheet.split.columns}</config:config-item>
`: ``}${sheet.split?.rows ? `              <config:config-item config:name="CursorPositionY" config:type="int">${sheet.split.rows}</config:config-item>
              <config:config-item config:name="VerticalSplitMode" config:type="short">2</config:config-item>
              <config:config-item config:name="VerticalSplitPosition" config:type="int">${sheet.split.rows}</config:config-item>
              <config:config-item config:name="PositionBottom" config:type="int">${sheet.split.rows}</config:config-item>
` : ""}              <config:config-item config:name="ActiveSplitRange" config:type="short">${(sheet.split?.columns ? 2 : 0) + (sheet.split?.rows ? 2 : 0)}</config:config-item>
            </config:config-item-map-entry>
`)}          </config:config-item-map-named>
        </config:config-item-map-entry>
      </config:config-item-map-indexed>
    </config:config-item-set>
  </office:settings>
</office:document-settings>`;
}

function createContent(sheets: FixedSpreadsheetOptions[], options: { timeZone?: string }): ReadableStream<Uint8Array> {
  const builder = new ODSBuilder;
  const rows = createSheets(builder, calcColumnStyles(builder, sheets), options);
  return byteStreamFromStringParts([
    contentPreamble(builder),
    rows,
    contentPostamble
  ]);
}

/** Generate an ODS file
    @returns Blob blob containing the ODS file
*/
export async function generateODS(options: SpreadsheetData | WorkbookData): Promise<File> {
  const inSheets = "sheets" in options ? options.sheets : [options];
  const sheets = inSheets.map(sheet => validateAndFixRowsColumns({ timeZone: options.timeZone, ...sheet }));
  const mimetype = "application/vnd.oasis.opendocument.spreadsheet";

  const archive = createArchive({
    async build(controller) {
      //mimetype must be the first entry and must be stored, not compressed
      await controller.addFile("mimetype", mimetype, new Date, { compressionLevel: 0 });
      //directory
      await controller.addFile("META-INF/manifest.xml", manifest, new Date);

      //the content (contains all the sheets)
      const outputSheet = createContent(sheets, options);
      await controller.addFile("content.xml", outputSheet, new Date);

      await controller.addFile("styles.xml", styles, new Date);
      await controller.addFile("settings.xml", createSettings(sheets), new Date);
    },
  });

  // ODS files are small enough to be kept in memory
  const buffers = new Array<Uint8Array>();
  for await (const chunk of archive)
    buffers.push(chunk);

  return new File(buffers, `${options?.title || "export"}.ods`, { type: mimetype });
}
