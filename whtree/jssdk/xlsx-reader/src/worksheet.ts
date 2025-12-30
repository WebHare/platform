/* eslint-disable @typescript-eslint/no-explicit-any */

import Stream from 'stream';
import type XlsxStreamReaderWorkBook from './workbook';
import type { UnpackArchiveFile } from '@webhare/zip';

type NodeDataItem = any;

export type XlsxCellValue = string | number | Temporal.PlainDate | boolean | null;
export type XlsxRow = XlsxCellValue[];

type InternalXlsxRow = {
  attributes: { [key: string]: string };
  values: XlsxRow;
  formulas: string[];
};

function guessFormat(format: string) {
  const hasdate = format.toUpperCase().includes("YY");
  if (hasdate)
    return "plaindate";
  return "number";
}
function excelFloatToEpochTime(val: number, date1904: boolean): number {
  const daynum = Math.floor(val);
  const remainder = val - daynum;
  const timepart = Math.floor(remainder * (86400 * 1000) + 0.5);

  return ((daynum - (date1904 ? 24107 : 25569)) * 86400 * 1000 + timepart);
}
function excelFloatToPlainDate(val: number, date1904: boolean): Temporal.PlainDate {
  return Temporal.PlainDate.from("1970-01-01").add({ days: Math.floor(excelFloatToEpochTime(val, date1904) / (86400 * 1000)) });
}

export default class XlsxStreamReaderWorkSheet extends Stream {
  id: any;
  workBook: XlsxStreamReaderWorkBook;
  name: any;
  options: any;
  workSheetStream: any;
  rowCount: number;
  sheetData: any;
  inRows: boolean;
  workingRow: InternalXlsxRow | undefined;
  currentCell: any;
  abortSheet: boolean;
  write = function () { };
  end = function () { };

  constructor(workBook: XlsxStreamReaderWorkBook, sheetName: any, workSheetId: any, workSheetStream: UnpackArchiveFile) {
    super();

    this.id = workSheetId;
    this.workBook = workBook;
    this.name = sheetName;
    this.options = workBook.options;
    this.workSheetStream = workSheetStream;
    this.rowCount = 0;
    this.sheetData = {};
    this.inRows = false;
    this.currentCell = {};
    this.abortSheet = false;
  }

  getColumnNumber(columnName: string): number {
    let i = columnName.search(/\d/);
    let colNum = 0;
    columnName.replace(/\D/g, (letter: string) => {
      colNum += (parseInt(letter, 36) - 9) * Math.pow(26, --i);
      return '';
    });
    return colNum - 1;
  }

  getColumnName(columnNumber: number): string | undefined {
    if (!columnNumber) return undefined;

    let columnName = '';
    let dividend = parseInt(String(columnNumber));
    let modulo = 0;
    while (dividend > 0) {
      modulo = (dividend - 1) % 26;
      columnName = String.fromCharCode(65 + modulo).toString() + columnName;
      dividend = Math.floor(((dividend - modulo) / 26));
    }
    return columnName;
  }

  async *rows(): AsyncGenerator<XlsxRow, void, unknown> {
    const rowQueue: InternalXlsxRow[] = [];
    let isDone = false;
    const listenerOn = (row: InternalXlsxRow) => rowQueue.push(row);
    const listenerEnd = () => isDone = true;

    this.on("row", listenerOn);
    this.on("end", listenerEnd);

    try {
      void this.process();
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!isDone || rowQueue.length > 0) {
        const next = rowQueue.shift();
        if (next) {
          yield next.values;
          continue;
        }

        //wait a tick so new rows can come in. TODO Optimize, instead of _parseXML streaming data itself, we should be streaming data directly and yield rows, and we'll be giving proper backpressure
        await new Promise<void>(resolve => setImmediate(() => resolve()));
      }
    } finally {
      this.off("row", listenerOn);
      this.off("end", listenerEnd);
    }
  }

  async process() {
    await this.workBook.readyForStreaming();
    await this.workBook._parseXML(this.workSheetStream, this._handleWorkSheetNode.bind(this));

    if (this.workingRow) {
      this.emit('row', this.workingRow);
      this.workingRow = undefined;
    }
    this.emit('end');
  }

  skip() {
    if (this.workSheetStream instanceof Stream) {
      setImmediate(this.emit.bind(this), 'end');
    } else {
      this.workSheetStream.autodrain();
    }
  }

  abort() {
    this.abortSheet = true;
  }

  private _handleWorkSheetNode(nodeData: NodeDataItem[]) {
    if (this.abortSheet) {
      return;
    }

    this.sheetData.cols = [];

    if (nodeData.length > 1 && nodeData[0].name === 'worksheet') {
      nodeData.shift();
    }

    switch (nodeData[0].name) {
      case 'worksheet':
      case 'sheetPr':
      case 'pageSetUpPr':
        return;

      case 'printOptions':
      case 'pageMargins':
      case 'pageSetup':
        this.inRows = false;
        if (this.workingRow) {
          this.emit('row', this.workingRow);
          this.workingRow = undefined;
        }
        break;

      case 'cols':
        return;

      case 'col':
        delete (nodeData[0].name);
        this.sheetData.cols.push(nodeData[0]);
        return;

      case 'sheetData':
        this.inRows = true;

        nodeData.shift();

      // fallthrough
      case 'row': {
        if (this.workingRow) {
          this.emit('row', this.workingRow);
          this.workingRow = undefined;
        }

        ++this.rowCount;

        let inNode = nodeData.shift() || {};
        if (typeof inNode !== 'object') {
          inNode = {};
        }
        this.workingRow = {
          attributes: inNode.attributes || {},
          values: [],
          formulas: [],
        };
        break;
      }
    }

    if (this.inRows === true) {
      const workingCell = nodeData.shift();
      const workingPart = nodeData.shift();
      let workingVal: any = nodeData.shift();

      if (!workingCell || !this.workingRow) {
        return;
      }

      if (workingCell && workingCell.attributes && workingCell.attributes.r) {
        this.currentCell = workingCell;
      }

      if (workingCell.name === 'c') {
        const cellNum = this.getColumnNumber(workingCell.attributes!.r!);
        while (this.workingRow.values.length < cellNum + 1) //we've missed cells
          this.workingRow.values.push(null);

        if (workingPart && workingPart.name && workingPart.name === 'f') {
          this.workingRow.formulas[cellNum] = workingVal;
        }

        switch (workingCell.attributes!.t) {
          case 's': {
            const index = parseInt(workingVal);
            workingVal = this.workBook._getSharedString(index);

            this.workingRow.values[cellNum] = (workingVal || workingVal === 0) ? workingVal : '';

            break;
          }
          case 'inlineStr': {
            this.workingRow.values[cellNum] = nodeData.shift() || '';
            break;
          }
          case 'n':
          case undefined: { //it's a number
            const formatId = workingCell.attributes.s ? Number(this.workBook.xfs[workingCell.attributes.s].attributes.numFmtId) : 0;
            const format = this.workBook.getFormat(formatId);
            const date1904 = this.workBook.workBookInfo.date1904;
            const asNumber = parseFloat(workingVal);
            if (isNaN(asNumber)) {
              this.workingRow.values[cellNum] = null;
            } else {
              switch (guessFormat(format)) {
                case "plaindate":
                  this.workingRow.values[cellNum] = excelFloatToPlainDate(Number(workingVal), date1904);
                  break;
                case "number":
                  this.workingRow.values[cellNum] = parseFloat(workingVal);
                  break;
              }
            }
            break;
          }
          case 'b': { //boolean
            this.workingRow.values[cellNum] = workingVal === '1' || workingVal === 'true';
            break;
          }

          case 'str':
          case 'e'://not sure?
          default: {
            this.workingRow.values[cellNum] = (workingVal || workingVal === 0) ? workingVal : '';

          }
        }
      }
      if (workingCell.name === 'v') {
        const cellNum = this.getColumnNumber(this.currentCell.attributes.r);

        this.currentCell = {};

        this.workingRow.values[cellNum] = workingPart || '';
      }
    } else {
      if (this.sheetData[nodeData[0].name]) {
        if (!Array.isArray(this.sheetData[nodeData[0].name])) {
          this.sheetData[nodeData[0].name] = [this.sheetData[nodeData[0].name]];
        }
        this.sheetData[nodeData[0].name].push(nodeData);
      } else {
        if (nodeData[0].name) {
          this.sheetData[nodeData[0].name] = nodeData;
        }
      }
    }
  }
}
