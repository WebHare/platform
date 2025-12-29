/* eslint-disable @typescript-eslint/no-explicit-any */

import ssf from 'ssf';
import Stream from 'stream';
import type XlsxStreamReaderWorkBook from './workbook';

type NodeDataItem = any;

export default class XlsxStreamReaderWorkSheet extends Stream {
  id: any;
  workBook: XlsxStreamReaderWorkBook;
  name: any;
  options: any;
  workSheetStream: any;
  rowCount: number;
  sheetData: any;
  inRows: boolean;
  workingRow: any;
  currentCell: any;
  abortSheet: boolean;
  write = function () { };
  end = function () { };

  constructor(workBook: XlsxStreamReaderWorkBook, sheetName: any, workSheetId: any, workSheetStream: any) {
    super();

    this.id = workSheetId;
    this.workBook = workBook;
    this.name = sheetName;
    this.options = workBook.options;
    this.workSheetStream = workSheetStream;
    this.rowCount = 0;
    this.sheetData = {};
    this.inRows = false;
    this.workingRow = {};
    this.currentCell = {};
    this.abortSheet = false;

    this._handleWorkSheetStream();
  }

  private _handleWorkSheetStream() {
    this.on('pipe', (srcPipe: any) => {
      this.workBook._parseXML.call(this, srcPipe, this._handleWorkSheetNode.bind(this), () => {
        if (this.workingRow.name) {
          delete (this.workingRow.name);
          this.emit('row', this.workingRow);
          this.workingRow = {};
        }
        this.emit('end');
      });
    });
  }

  getColumnNumber(columnName: string): number {
    let i = columnName.search(/\d/);
    let colNum = 0;
    columnName.replace(/\D/g, (letter: string) => {
      colNum += (parseInt(letter, 36) - 9) * Math.pow(26, --i);
      return '';
    });

    return colNum;
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

  process() {
    this.workSheetStream.pipe(this);
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
        if (this.workingRow.name) {
          delete (this.workingRow.name);
          this.emit('row', this.workingRow);
          this.workingRow = {};
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
      case 'row':
        if (this.workingRow.name) {
          delete (this.workingRow.name);
          this.emit('row', this.workingRow);
          this.workingRow = {};
        }

        ++this.rowCount;

        this.workingRow = nodeData.shift() || {};
        if (typeof this.workingRow !== 'object') {
          this.workingRow = {};
        }
        this.workingRow.values = [];
        this.workingRow.formulas = [];
        break;
    }

    if (this.inRows === true) {
      const workingCell = nodeData.shift();
      const workingPart = nodeData.shift();
      let workingVal: any = nodeData.shift();

      if (!workingCell) {
        return;
      }

      if (workingCell && workingCell.attributes && workingCell.attributes.r) {
        this.currentCell = workingCell;
      }

      if (workingCell.name === 'c') {
        const cellNum = this.getColumnNumber(workingCell.attributes!.r!);

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
          case 'str':
          case 'b':
          case 'n':
          case 'e':
          default: {
            if (this.options.formatting && workingVal) {
              if (this.workBook.hasFormatCodes) {
                const formatId = workingCell.attributes.s ? this.workBook.xfs[workingCell.attributes.s].attributes.numFmtId : 0;
                const date1904 = this.workBook.workBookInfo.date1904;
                if (typeof formatId !== 'undefined') {
                  const format = this.workBook.formatCodes[formatId];
                  if (typeof format === 'undefined') {
                    try {
                      workingVal = ssf.format(Number(formatId), Number(workingVal), { date1904 });
                    } catch (e) {
                      workingVal = '';
                    }
                  } else if (format !== 'General') {
                    try {
                      workingVal = ssf.format(format, Number(workingVal), { date1904 });
                    } catch (e) {
                      workingVal = '';
                    }
                  }
                }
              } else if (!isNaN(parseFloat(workingVal))) {
                workingVal = parseFloat(workingVal);
              }
            }

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
