import type { Range } from "vscode-languageserver-textdocument";
import * as test from "@webhare/test";
import { toFSPath } from "@webhare/services";
import { readFileSync } from "node:fs";
import type { DocumentsLike, TextDocumentLike } from "@mod-devkit/js/language-server/types";
import { DiagnosticsProcessor } from "@mod-devkit/js/language-server/lsp-validation";
import type { Location, Diagnostic, TextDocumentPositionParams } from "vscode-languageserver";

export function getTextAtRange(content: string, range: Range) {
  const lines = content.split('\n').slice(range.start.line, range.end.line + 1);
  //'end' first otherwise we move the text pointed to by end
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, range.end.character + 1);
  lines[0] = lines[0].slice(range.start.character);
  return lines.join('\n');
}

export function getTextAtLocation(loc: Location) {
  if (loc.uri.startsWith("file:////") || (loc.uri.startsWith("file://") && !loc.uri.startsWith("file:///"))) //VScode is stricter than new URL
    throw new Error(`Invalid file URI ${loc.uri} - should be file:///path/to/file`);
  return getTextAtRange(readFileSync(new URL(loc.uri).pathname, 'utf8'), loc.range);
}

class MockTextDocument implements TextDocumentLike {
  content = "";
  readonly uri: string;
  readonly languageId: string;

  constructor(uri: string, languageId: string) {
    this.uri = uri;
    this.languageId = languageId;
  }

  getText(range?: Range): string {
    if (!range)
      return this.content;
    return getTextAtRange(this.content, range);
  }
  getPositionFor(text: string, options?: { goRight?: number }): TextDocumentPositionParams | null {
    const index = this.content.indexOf(text);
    if (index === -1)
      return null;

    const lineNumber = this.content.slice(0, index).split('\n').length - 1;
    const colNumber = index - this.content.lastIndexOf('\n', index) - 1;
    return {
      textDocument: { uri: this.uri },
      position: { line: lineNumber, character: colNumber + (options?.goRight || 0) }
    };
  }
}

export class MockDocuments implements DocumentsLike, AsyncDisposable {
  store = new Map<string, MockTextDocument>;
  storeArray = new Array<MockTextDocument>;
  diagnostics = new Map<string, Diagnostic[]>();
  diagprocessor = new DiagnosticsProcessor(this, (uri, diagnostics) => this.updateDiagnostics(uri, diagnostics));

  get(uri: number | string): MockTextDocument | undefined {
    return typeof uri === "number" ? this.storeArray[uri] : this.store.get(uri);
  }
  async addResource(...resource: string[]) {
    for (const res of resource) {
      const file = toFSPath(res);
      const url = "file://" + file;
      const source = readFileSync(file, 'utf8');
      await this.setDoc(url, source);
    }
  }
  async setDoc(uri: string, content: string) {
    const langid = uri.endsWith(".whlib") ? "harescript"
      : uri.match(/\/screens\/.*\.xml$/) ? "webhare-screens-xml"
        : "plaintext";

    let doc = this.store.get(uri);
    if (!doc) {
      doc = new MockTextDocument(uri, langid);
      this.store.set(uri, doc);
      this.storeArray.push(doc);
    }
    doc.content = content;

    await this.diagprocessor.update(uri);
  }
  updateDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    this.diagnostics.set(uri, diagnostics);
  }
  async waitSettled() {
    //TODO don't poll, just properly integrate with the diagprocessor
    await test.wait(() => !this.diagprocessor.isProcessing());
  }

  async [Symbol.asyncDispose]() {
    await this.waitSettled();
  }
}
