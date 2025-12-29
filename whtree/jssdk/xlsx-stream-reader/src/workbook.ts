/* eslint-disable @typescript-eslint/no-explicit-any */

import Fs from 'fs';
import Tmp from 'tmp';
import type Stream from 'stream';
import { Writable } from 'stream';
import unzipper from 'unzipper';
import Sax from 'sax';
import XlsxStreamReaderWorkSheet from './worksheet';

Tmp.setGracefulCleanup();

type TmpNode = any;

interface WorkBookOptions {
  saxTrim?: boolean;
  saxPosition?: boolean;
  saxStrictEntities?: boolean;
  saxStrict?: boolean;
  normalize?: boolean;
  verbose?: boolean;
  formatting?: boolean;
}

interface WorkBookInfo {
  sheetRelationships: { [key: string]: string };
  sheetRelationshipsNames: { [key: string]: string };
  date1904: boolean;
}

class XlsxStreamReaderWorkBook extends Writable {
  options: WorkBookOptions;
  workBookSharedStrings: any[];
  workBookInfo: WorkBookInfo;
  parsedWorkBookInfo: boolean;
  parsedWorkBookRels: boolean;
  parsedSharedStrings: boolean;
  waitingWorkSheets: Array<{ sheetNo: string; name: string; path: string; sheetPath: string }>;
  workBookStyles: any[];
  hasFormatCodes: boolean;
  formatCodes: { [key: string]: any };
  xfs: any;
  abortBook: boolean;
  write = () => false;
  end = () => this;

  constructor(options: WorkBookOptions = {}) {
    super();

    this.options = options;
    this.workBookSharedStrings = [];
    this.workBookInfo = { sheetRelationships: {}, sheetRelationshipsNames: {}, date1904: false };
    this.parsedWorkBookInfo = false;
    this.parsedWorkBookRels = false;
    this.parsedSharedStrings = false;
    this.waitingWorkSheets = [];
    this.workBookStyles = [];
    this.hasFormatCodes = false;
    this.formatCodes = {};
    this.xfs = {};
    this.abortBook = false;
    this._handleWorkBookStream();
  }

  _handleWorkBookStream() {
    let match: RegExpMatchArray | null;

    this.on('pipe', (srcPipe: Stream.Readable) => {
      (srcPipe as any).pipe(unzipper.Parse())
        .on('error', (err: Error) => {
          this.emit('error', err);
        })
        .on('entry', (entry: any) => {
          if (this.abortBook) {
            entry.autodrain();
            return;
          }
          switch (entry.path) {
            case 'xl/workbook.xml':
              this._parseXML(entry, this._parseWorkBookInfo, () => {
                this.parsedWorkBookInfo = true;
                this.emit('workBookInfo');
              });
              break;
            case 'xl/_rels/workbook.xml.rels':
              this._parseXML(entry, this._parseWorkBookRels, () => {
                this.parsedWorkBookRels = true;
                this.emit('workBookRels');
              });
              break;
            case '_rels/.rels':
              entry.autodrain();
              break;
            case 'xl/sharedStrings.xml':
              this._parseXML(entry, this._parseSharedStrings, () => {
                this.parsedSharedStrings = true;
                this.emit('sharedStrings');
              });
              break;
            case 'xl/styles.xml':
              this._parseXML(entry, this._parseStyles, () => {
                if (Object.keys(this.formatCodes).length > 0) {
                  this.hasFormatCodes = true;
                }
                const cellXfsIndex = this.workBookStyles.findIndex((item: any) => {
                  return item.name === 'cellXfs';
                });
                this.xfs = this.workBookStyles.filter((item: any, index: number) => {
                  return item.name === 'xf' && index > cellXfsIndex;
                });
                this.emit('styles');
              });
              break;
            default:
              if ((match = entry.path.match(/xl\/(worksheets\/sheet(\d+)\.xml)/i))) {
                const sheetPath = match[1];
                const sheetNo = match[2];

                if (this.parsedWorkBookInfo === false ||
                  this.parsedWorkBookRels === false ||
                  this.parsedSharedStrings === false ||
                  this.waitingWorkSheets.length > 0
                ) {
                  const { name } = Tmp.fileSync({});
                  const stream = Fs.createWriteStream(name);

                  this.waitingWorkSheets.push({ sheetNo: sheetNo, name: entry.path, path: name, sheetPath: sheetPath });

                  entry.pipe(stream);
                } else {
                  const name = this._getSheetName(sheetPath);
                  const workSheet = new (XlsxStreamReaderWorkSheet as any)(this, name, sheetNo, entry);

                  this.emit('worksheet', workSheet);
                }
              } else if ((match = entry.path.match(/xl\/worksheets\/_rels\/sheet(\d+)\.xml.rels/i))) {
                entry.autodrain();
              } else {
                entry.autodrain();
              }
              break;
          }
        })
        .on('close', (entry: any) => {
          if (this.waitingWorkSheets.length > 0) {
            let currentBook = 0;
            const processBooks = () => {
              const sheetInfo = this.waitingWorkSheets[currentBook];
              const workSheetStream = Fs.createReadStream(sheetInfo.path);
              const name = this._getSheetName(sheetInfo.sheetPath);
              const workSheet = new (XlsxStreamReaderWorkSheet as any)(this, name, sheetInfo.sheetNo, workSheetStream);

              workSheet.on('end', (node: any) => {
                ++currentBook;
                if (currentBook === this.waitingWorkSheets.length) {
                  setImmediate(this.emit.bind(this), 'end');
                } else {
                  setImmediate(processBooks);
                }
              });

              setImmediate(this.emit.bind(this), 'worksheet', workSheet);
            };
            setImmediate(processBooks);
          } else {
            setImmediate(this.emit.bind(this), 'end');
          }
        });
    });
  }

  abort() {
    (this as any).abortBook = true;
  }

  _parseXML(entryStream: Stream.Readable, entryHandler: (this: XlsxStreamReaderWorkBook, node: TmpNode) => void, endHandler: () => void) {
    let isErred = false;

    let tmpNode: TmpNode[] = [];
    let tmpNodeEmit = false;

    const saxOptions: any = {
      trim: this.options.saxTrim,
      position: this.options.saxPosition,
      strictEntities: this.options.saxStrictEntities,
      normalize: this.options.normalize
    };

    const parser = Sax.createStream(this.options.saxStrict, saxOptions);

    entryStream.on('end', () => {
      if (this.abortBook) return;
      if (!isErred) setImmediate(endHandler);
    });

    parser.on('error', (error: Error) => {
      if (this.abortBook) return;
      isErred = true;

      this.emit('error', error);
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

    try {
      (entryStream as any).pipe(parser);
    } catch (error) {
      this.emit('error', error);
    }
  }

  _getSharedString(stringIndex: number) {
    if (stringIndex > this.workBookSharedStrings.length) {
      if (this.options.verbose) {
        this.emit('error', 'missing shared string: ' + stringIndex);
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

  _parseStyles(nodeData: any[]) {
    nodeData.forEach((data: any) => {
      if (data.name === 'numFmt') {
        this.formatCodes[data.attributes.numFmtId] = data.attributes.formatCode;
      }
      this.workBookStyles.push(data);
    });
  }

  _parseWorkBookInfo(nodeData: any[]) {
    nodeData.forEach((data: any) => {
      if (data.name === 'sheet') {
        this.workBookInfo.sheetRelationshipsNames[data.attributes['r:id']] = data.attributes.name;
      } else if (data.name === 'workbookPr' && data.attributes && data.attributes.date1904 === '1') {
        this.workBookInfo.date1904 = true;
      }
    });
  }

  _parseWorkBookRels(nodeData: any[]) {
    nodeData.forEach((data: any) => {
      if (data.name === 'Relationship') {
        this.workBookInfo.sheetRelationships[data.attributes.Target] = data.attributes.Id;
      }
    });
  }

  _getSheetName(sheetPath: string) {
    return this.workBookInfo.sheetRelationshipsNames[this.workBookInfo.sheetRelationships[sheetPath]];
  }
}

export default XlsxStreamReaderWorkBook;
