import { emplace } from "@webhare/std";
import type { DiagnosticsCallback, DocumentsLike, TextDocumentLike } from "./types";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { loadlib } from "@webhare/harescript";
import { WebHareBlob } from "@webhare/services";
import { missingSymbolErrorCodes, uriToResourcePath } from "./lsp-services";

type ValidationMessage = {
  iserror: boolean;
  iswarning: boolean;
  ishint: boolean;
  filename: string;
  line: number;
  col: number;
  code: number;
  msg1: string;
  msg2: string;
  message: string;
  istopfile: boolean;
};

//error codes where msg1 contains the error string. not robust against backquotes in string but fixes a lot of errors otherwise;
const extendStringWarningCodes = [29];

//we need to get the length right for quickfixes to work
function getErrorLength(msg: ValidationMessage) {
  if (msg.iserror && missingSymbolErrorCodes.includes(msg.code))
    return msg.msg1.length;
  if (msg.iswarning && extendStringWarningCodes.includes(msg.code))
    return msg.msg1.length + 2;
  return 0;
}

async function getHSDiagnostics(respath: string, content: string): Promise<Diagnostic[]> {
  //NOTE ValidateHarescriptSource validates more than just HareScript as it wraps ValidateSingleFileAdhoc
  const validation = await loadlib("mod::devkit/lib/lsp/editorsupport.whlib").ValidateHarescriptSource(respath, WebHareBlob.from(content)) as { messages: ValidationMessage[] };
  if (validation.messages.length === 0)
    return [];

  const doclines: string[] = content.split(/\r?\n/g);
  const diagnostics = validation.messages.map(msg => ({
    //Information is the highest level still directly visible in VSCode's problem tab. 29 = unused loadlib .. a warning looks too heavy
    severity: msg.iserror ? DiagnosticSeverity.Error : msg.iswarning && msg.code !== 29 ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information,
    message: msg.message,
    data: msg,
    range: msg.col === 0 ?
      {
        // libxml gives no columns posiitions. let's highlight the line without the initial whitespace
        start: { line: msg.line - 1, character: doclines[msg.line - 1]?.match(/^ */)?.[0].length ?? 0 },
        end: { line: msg.line - 1, character: doclines[msg.line - 1]?.length ?? 1 }
      } :
      {
        start: { line: msg.line - 1, character: msg.col - 1 },
        end: { line: msg.line - 1, character: msg.col - 1 + getErrorLength(msg) } //TODO ? for some erro codes we might be able to deduce length based on msg1 or msg2?
      },
  }) satisfies Diagnostic);
  return diagnostics;
}

export async function getDiagnostics(document: TextDocumentLike): Promise<Diagnostic[]> {
  const content = document.getText();
  const respath = uriToResourcePath(document.uri);
  if (!respath) {
    console.log(`getDiagnostic: no respath so ignoring: ${document.uri}`);
    return [];
  }

  //TODO original LSP checked the md5 before actually re-requesting diagnostics and would otherwise reuse. maybe we should too ?
  //TODO safer in a worker?

  const languageId = document.languageId;
  let diagnostics: Diagnostic[] = [];
  diagnostics = await getHSDiagnostics(respath, content);
  console.log(`getDiagnostic ${respath}: ${content.length} bytes, languageid = ${languageId}, ${diagnostics.length} diagnostics`);
  return diagnostics;
}

//Quick&Dirty solution to prevent multiple didChangeContents.. replace with std.serialize(coalesce:true)
class DiagUpdate {
  private mustRestart = false;
  private uri;
  private updater: Promise<void> | null = null;
  proc: DiagnosticsProcessor;

  constructor(proc: DiagnosticsProcessor, uri: string) {
    this.proc = proc;
    this.uri = uri;
    this.updater = this.updateDiagnostics();
  }
  async restart() {
    if (this.mustRestart)
      return;
    this.mustRestart = true;
    if (!this.updater)
      this.updater = this.updateDiagnostics();
  }
  async updateDiagnostics() {
    for (; ;) {
      const doc = this.proc.docs.get(this.uri);
      if (doc === undefined)
        break; //give up

      //clear current diagnostics
      this.proc.onDiagnostic(this.uri, []);
      const result = await getDiagnostics(doc);

      if (!this.mustRestart) {
        //no new changes to check, return the final result
        this.proc.onDiagnostic(this.uri, result);
        break;
      }

      //restart requested due to async hanges, try again
      this.mustRestart = false;
    }
    this.updater = null;
  }
  isStale() {
    return this.mustRestart || this.updater !== null;
  }
}

export class DiagnosticsProcessor {
  docs;
  onDiagnostic;
  pendigDiagUpdates = new Map<string, DiagUpdate>;

  constructor(docs: DocumentsLike, onDiagnostic: DiagnosticsCallback) {
    this.docs = docs;
    this.onDiagnostic = onDiagnostic;
  }

  async update(uri: string) {
    emplace(this.pendigDiagUpdates, uri, {
      insert: () => new DiagUpdate(this, uri),
      update: (v) => {
        void v.restart(); //FIXME sure we want to discard errors here? don't we need some sort of serialize?
        return v;
      }
    });
  }

  isProcessing(): boolean {
    return [...this.pendigDiagUpdates.values()].some((v) => v.isStale());
  }
}
