/* eslint-disable @typescript-eslint/no-explicit-any */

import Sax from 'sax';
import XlsxStreamReaderWorkSheet from './worksheet';
import type { UnpackArchiveDirectory, UnpackArchiveFile, UnpackArchiveResult } from '@webhare/zip';
import { throwError } from '@webhare/std';

type TmpNode = any;

interface WorkBookOptions {
  saxPosition?: boolean;
  saxStrictEntities?: boolean;
  saxStrict?: boolean;
  normalize?: boolean;
  verbose?: boolean;
}

interface WorkBookInfo {
  sheetRelationships: { [key: string]: string };
  sheetRelationshipsNames: { [key: string]: string };
  date1904: boolean;
}

const XlsxBuiltinFormatCodes: { [key: number]: string } = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
  56: '"上午/下午 "hh"時"mm"分"ss"秒 "',
};

class XlsxStreamReaderWorkBook {
  options: WorkBookOptions;
  workBookSharedStrings: any[];
  workBookInfo!: WorkBookInfo; //loaded immediately at construction by xlsx-reader, so noone can publicly access it before it's ready
  parsedSharedStrings: boolean;
  waitingWorkSheets: Array<{ sheetNo: string; name: string; path: string; sheetPath: string }>;
  workBookStyles: any[];
  hasFormatCodes: boolean;
  formatCodes: { [key: string]: any };
  xfs: any;
  abortBook: boolean;
  write = () => false;
  end = () => this;
  ready;
  private _readyForStreamingPromise: Promise<void> | null = null;

  constructor(public source: UnpackArchiveResult, options: WorkBookOptions = {}) {

    this.options = options;
    this.workBookSharedStrings = [];
    this.parsedSharedStrings = false;
    this.waitingWorkSheets = [];
    this.workBookStyles = [];
    this.hasFormatCodes = false;
    this.formatCodes = {};
    this.xfs = {};
    this.abortBook = false;
    this.ready = this.loadWorkBookInfo();
  }

  private async loadWorkBookInfo(): Promise<void> {
    const workbook = this.source.find(_ => _.fullPath === 'xl/workbook.xml') || throwError('xl/workbook.xml not found in archive');
    const workBookInfo: WorkBookInfo = { sheetRelationships: {}, sheetRelationshipsNames: {}, date1904: false };
    await this._parseXML(workbook, nodeData => this._parseWorkBookInfo(nodeData, workBookInfo));

    const workbookRels = this.source.find(_ => _.fullPath === 'xl/_rels/workbook.xml.rels') || throwError('xl/_rels/workbook.xml.rels not found in archive');
    await this._parseXML(workbookRels, nodeData => this._parseWorkBookRels(nodeData, workBookInfo));

    this.workBookInfo = workBookInfo;
  }

  async readyForStreaming() {
    this._readyForStreamingPromise ||= this.prepareForStreaming();
    return this._readyForStreamingPromise;
  }

  getSheets(): Array<{ name: string; sheetPath: string }> {
    const sheets: Array<{ name: string; sheetPath: string }> = [];
    for (const [id, name] of Object.entries(this.workBookInfo.sheetRelationshipsNames)) { //sheetRelationshipsNames were inserted in the XLSX order
      const matchingrel = Object.entries(this.workBookInfo.sheetRelationships).find(([_, relid]) => relid === id);
      if (matchingrel)
        sheets.push({ name, sheetPath: matchingrel[0] });
    }
    return sheets;
  }

  /** Open a sheet
   * @param sheet - Sheet index (0-based) or name
   */
  openSheet(sheet: number | string) {
    const sheets = this.getSheets();
    const selectedSheet = typeof sheet === 'number' ? sheets[sheet] : sheets.find(s => s.name.toLowerCase() === sheet.toLowerCase());
    if (!selectedSheet)
      throw new Error(`Sheet not found: ${sheet}`);

    const file = this.source.find(_ => _.fullPath === 'xl/' + selectedSheet.sheetPath) ?? throwError(`Sheet file not found: ${selectedSheet.sheetPath}`);
    if (file.type !== "file")
      throw new Error(`Sheet path is not a file: ${selectedSheet.sheetPath}`);

    return new XlsxStreamReaderWorkSheet(this, selectedSheet.name, '', file);
  }

  private async prepareForStreaming() {
    const sharedStrings = this.source.find(_ => _.fullPath === 'xl/sharedStrings.xml');
    if (sharedStrings)
      await this._parseXML(sharedStrings, this._parseSharedStrings, { trim: false });

    const styles = this.source.find(_ => _.fullPath === 'xl/styles.xml');
    if (styles) {
      await this._parseXML(styles, this._parseStyles);

      if (Object.keys(this.formatCodes).length > 0) {
        this.hasFormatCodes = true;
      }
      const cellXfsIndex = this.workBookStyles.findIndex((item: any) => {
        return item.name === 'cellXfs';
      });
      this.xfs = this.workBookStyles.filter((item: any, index: number) => {
        return item.name === 'xf' && index > cellXfsIndex;
      });
    }
  }

  abort() {
    (this as any).abortBook = true;
  }

  async _parseXML(entry: UnpackArchiveDirectory | UnpackArchiveFile, entryHandler: (this: XlsxStreamReaderWorkBook, node: TmpNode) => void, { trim } = { trim: true }) {
    if (entry.type !== "file")
      throw new Error("Cannot parse XML from a folder entry");

    let isErred: Error | undefined;

    let tmpNode: TmpNode[] = [];
    let tmpNodeEmit = false;

    const saxOptions: any = {
      trim: trim,
      position: this.options.saxPosition,
      strictEntities: this.options.saxStrictEntities,
      normalize: this.options.normalize
    };

    const parser = Sax.createStream(this.options.saxStrict, saxOptions);

    parser.on('error', (error: Error) => {
      if (this.abortBook) return;
      isErred = error;
    });

    parser.on('opentag', (node: any) => {
      if (node.name === 'rPh') {
        this.abortBook = true;
        return;
      }
      if (this.abortBook) return;
      if (Object.keys(node.attributes).length === 0) {
        delete (node.attributes);
      }
      if (node.isthisClosing) {
        if (tmpNode.length > 0) {
          entryHandler.call(this, tmpNode);
          tmpNode = [];
        }
        tmpNodeEmit = true;
      }
      delete (node.isthisClosing);
      tmpNode.push(node);
    });

    parser.on('text', (text: string) => {
      if (this.abortBook) return;
      tmpNodeEmit = true;
      tmpNode.push(text);
    });

    parser.on('closetag', (nodeName: string) => {
      if (nodeName === 'rPh') {
        this.abortBook = false;
        return;
      }
      if (this.abortBook) return;
      if (tmpNodeEmit) {
        entryHandler.call(this, tmpNode);
        tmpNodeEmit = false;
        tmpNode = [];
      } else if (tmpNode.length && tmpNode[tmpNode.length - 1] && tmpNode[tmpNode.length - 1].name === nodeName) {
        tmpNode.push('');
        entryHandler.call(this, tmpNode);
        tmpNodeEmit = false;
        tmpNode = [];
      }
      tmpNode.splice(-1, 1);
    });

    const reader = entry.stream().getReader();

    // eslint-disable-next-line no-unmodified-loop-condition -- set asynchronously
    while (!isErred) {
      const { done, value } = await reader.read();
      if (done)
        break;

      if (!parser.write(Buffer.from(value)))
        await new Promise(resolve => parser.once('drain', resolve));
    }
    if (isErred)
      throw isErred;
  }

  _getSharedString(stringIndex: number) {
    if (stringIndex > this.workBookSharedStrings.length) {
      if (this.options.verbose) {
        console.error('missing shared string: ' + stringIndex);
      }
      return;
    }
    return this.workBookSharedStrings[stringIndex];
  }

  _parseSharedStrings(nodeData: any[]) {
    const isSharedStringItem = Boolean(nodeData.find((n: any) => n && n.name === 'si'));

    const nodeObjValue = nodeData.pop();
    const nodeObjName = nodeData.pop();

    if (isSharedStringItem) {
      if (nodeObjName && nodeObjName.name === 't') {
        this.workBookSharedStrings.push(nodeObjValue);
      } else {
        this.workBookSharedStrings.push('');
      }
    } else {
      if (nodeObjName && nodeObjName.name === 't') {
        this.workBookSharedStrings[this.workBookSharedStrings.length - 1] += nodeObjValue;
      }
    }
  }

  getFormat(numFmt: number) {
    return this.formatCodes[numFmt] || XlsxBuiltinFormatCodes[numFmt] || "General";
  }

  _parseStyles(nodeData: any[]) {
    nodeData.forEach((data: any) => {
      if (data.name === 'numFmt') {
        this.formatCodes[data.attributes.numFmtId] = data.attributes.formatCode;
      }
      this.workBookStyles.push(data);
    });
  }

  _parseWorkBookInfo(nodeData: TmpNode[], workBookInfo: WorkBookInfo) {
    nodeData.forEach(data => {
      if (data.name === 'sheet') {
        workBookInfo.sheetRelationshipsNames[data.attributes['r:id']] = data.attributes.name;
      } else if (data.name === 'workbookPr' && data.attributes && data.attributes.date1904 === '1') {
        workBookInfo.date1904 = true;
      }
    });
  }

  _parseWorkBookRels(nodeData: any[], workBookInfo: WorkBookInfo) {
    nodeData.forEach((data: any) => {
      if (data.name === 'Relationship') {
        workBookInfo.sheetRelationships[data.attributes.Target] = data.attributes.Id;
      }
    });
  }

  _getSheetName(sheetPath: string) {
    return this.workBookInfo.sheetRelationshipsNames[this.workBookInfo.sheetRelationships[sheetPath]];
  }
}

export default XlsxStreamReaderWorkBook;
