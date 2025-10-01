import { loadlib } from "@webhare/harescript";
import { backendConfig, toResourcePath } from "@webhare/services";
import { mapHareScriptPath } from "@webhare/harescript/src/wasm-support";
import {
  type CodeAction,
  CodeActionKind,
  type CodeActionParams,
  type Definition,
  DiagnosticSeverity, type ExecuteCommandParams, type FormattingOptions, type Hover, type Location, type TextDocumentPositionParams, type WorkspaceEdit
} from "vscode-languageserver";
import type { TextEdit } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { DocumentsLike, TextDocumentLike } from "./types";
import type { StackTraceResponse } from "@webhare/lsp-types";
import { rewriteResource } from "../validation/rewrite";

export const hs_warningcode_unusedloadlib = 29;

export const missingSymbolErrorCodes: number[] = [
  9, // UnknownVariable
  76, // UnknownObjectType
  88, // MisspelledFunction
  139, // UnknownFunction
  178 // MisspelledObjectType
];

interface HSEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newtext: string;
}

export function uriToResourcePath(uri: string): string | undefined {
  const path = URI.parse(uri).fsPath;
  return toResourcePath(path, { allowUnmatched: true }) || `direct::${path}`;
}

function getKeywordAt(docs: DocumentsLike, where: TextDocumentPositionParams): string {
  const line = docs.get(where.textDocument.uri)?.getText({ start: { line: where.position.line, character: 0 }, end: { line: where.position.line, character: Infinity } });
  //simple token splitter
  const tokens = line?.split(/([^a-zA-Z0-9_]+)/);
  if (!tokens)
    return '';

  let pos = where.position.character;
  while (pos > 0 && tokens.length && pos > tokens[0].length) {
    pos -= tokens[0].length;
    tokens.shift();
  }
  return tokens[0] || '';
}

async function doSymbolSearch(keyword: string): Promise<{
  results: Array<{
    objectid: string;
    path: string;
    type: string;
    name: string;
    position: string;
    line: number;
    col: number;
    link: string;
    ispublic: boolean;
    objtype: string;
    definition: string;
    commenttext: string;
    definitionpath: string;
    canonicalloadlib: string;
  }>;
}> {
  const result = await loadlib("mod::devkit/lib/lsp/editorservices.whlib").SymbolSearch(keyword);
  return result;
}

export async function getDefinitions(docs: DocumentsLike, e: TextDocumentPositionParams): Promise<Definition> {
  const keyword = getKeywordAt(docs, e);
  console.log("Got definitionRequest for", keyword);

  const result = await doSymbolSearch(keyword);
  const locations: Location[] = [];
  for (const res of result.results) {
    try {
      locations.push({
        uri: "file://" + mapHareScriptPath(res.path),
        range: {
          start: { line: res.line - 1, character: res.col - 1 },
          end: { line: res.line - 1, character: res.col + res.name.length - 2 }
        }
      });
    } catch (ignore) { /*ignore - this is generally about invalid resource paths */ }
  }
  return locations.length === 1 ? locations[0] : locations;
}

export async function getHover(docs: DocumentsLike, e: TextDocumentPositionParams, acceptMarkdown: boolean): Promise<Hover | null> {
  const keyword = getKeywordAt(docs, e);
  console.log("Got hover for", keyword);

  const result = await doSymbolSearch(keyword);
  if (result.results.length !== 1)
    return null;

  if (acceptMarkdown)
    return { contents: { kind: "markdown", value: `# ${keyword}\n\`\`\`harescript\n${result.results[0].definition}\n\`\`\`` } };
  return { contents: { kind: "plaintext", value: result.results[0].definition } };
}

export async function getCodeActions(params: CodeActionParams): Promise<CodeAction[]> {
  // console.log("code action request for " + params.textDocument.uri);
  // console.dir(params, { depth: 10 });

  const missingsymbol = params.context.diagnostics.find(_ => _.severity === DiagnosticSeverity.Error && missingSymbolErrorCodes.includes(_.data?.code));
  const codeactions: CodeAction[] = [];

  if (missingsymbol) {
    codeactions.push({
      kind: CodeActionKind.QuickFix,
      title: "Add missing loadlib",
      command: {
        title: "Add missing loadlib",
        command: "addMissingLoadlib",
        arguments: [params.textDocument.uri, missingsymbol.data.msg1]
      }
    });
  }
  const unusedLoadlibHint = params.context.diagnostics.find(_ => _.severity === DiagnosticSeverity.Information && _.data?.code === hs_warningcode_unusedloadlib);
  if (unusedLoadlibHint) {
    codeactions.push({
      kind: CodeActionKind.QuickFix,
      title: "Remove unused loadlib",
      command: {
        title: "Remove unused loadlib",
        command: "removeUnusedLoadlib",
        arguments: [params.textDocument.uri, unusedLoadlibHint.data.msg1]
      }
    });
  }

  return codeactions;
}

export async function doStackTraceRequest(lastguid: string | null): Promise<StackTraceResponse> {
  const response = await loadlib("mod::devkit/lib/lsp/service.whlib").LSP_StackTraceRequest(null, lastguid || "") as StackTraceResponse;
  for (const error of response.errors)
    for (const stack of error.stack)
      if (stack.filename.startsWith("whinstallationroot::")) {
        stack.filename = backendConfig.installationroot + stack.filename.substring(20);
        stack.editorpath = stack.filename;
      } else if (stack.filename.match(/.*::.*/)) { //resource path?
        stack.filename = mapHareScriptPath(stack.filename) ?? stack.filename;
        stack.editorpath = stack.filename;
      }

  return response;
}

export async function doExecuteCommand(docs: DocumentsLike, params: ExecuteCommandParams): Promise<WorkspaceEdit | { error: string }> {
  if (params.command === 'addMissingLoadlib') {
    const uri: string = params.arguments?.[0] || '';
    const identifier: string = params.arguments?.[1] || '';
    const text: string = docs.get(uri)?.getText() || '';
    const result = await loadlib("mod::devkit/lib/lsp/service.whlib").DirectLSP_AddMissingLoadlib(uriToResourcePath(uri), text, uri, identifier) as HSEdit | { error: string };
    if ("error" in result)
      return { error: result.error };
    else
      return { changes: { [uri]: [{ range: result.range, newText: result.newtext }] } };
  }

  if (params.command === 'removeUnusedLoadlib') {
    const uri: string = params.arguments?.[0] || '';
    const identifier: string = params.arguments?.[1] || '';
    const text: string = docs.get(uri)?.getText() || '';
    const result = await loadlib("mod::devkit/lib/lsp/service.whlib").DirectLSP_RemoveUnusedLoadlib(uriToResourcePath(uri), text, uri, identifier) as HSEdit | { error: string };
    if ("error" in result)
      return { error: result.error };
    else
      return { changes: { [uri]: [{ range: result.range, newText: result.newtext }] } };
  }

  return {
    error: `Unrecognized command '${params.command}'`
  };
}

export async function doReformat(doc: TextDocumentLike, options: FormattingOptions): Promise<TextEdit[] | null> {
  console.log("formatting request for " + doc.uri + " type " + doc.languageId);
  const respath = uriToResourcePath(doc.uri);
  if (!respath)
    return null;

  const rewriteresult = await rewriteResource(respath, doc.getText());
  if (!rewriteresult)
    return null;

  //but ideally we'd ship a limited set of edits, not a full rewrite
  return [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 999999999, character: 999999999 } },
      newText: rewriteresult
    }
  ];
}
