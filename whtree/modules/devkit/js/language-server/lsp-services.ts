import { loadlib } from "@webhare/harescript";
import { backendConfig, isAbsoluteResource, toFSPath, toResourcePath } from "@webhare/services";
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
import { readFileSync } from "node:fs";

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

function getKeywordOrTextAt(docs: DocumentsLike, where: TextDocumentPositionParams): string {
  const doc = docs.get(where.textDocument.uri);
  const line = doc?.getText({ start: { line: where.position.line, character: 0 }, end: { line: where.position.line, character: Infinity } });
  if (!line)
    return "";

  if (doc?.uri.endsWith(".yml") || doc?.uri.endsWith(".yaml")) {
    //Heuristic - detect selecting "property: value" and return the full value.
    const asPropValueLine = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
    if (asPropValueLine) {
      const prop = asPropValueLine[1];
      const value = asPropValueLine[2];
      const propStart = line.indexOf(prop);
      const valueStart = line.indexOf(value, propStart + prop.length);
      if (where.position.character >= valueStart && where.position.character <= valueStart + value.length) {
        if ([`'`, `"`].includes(value[0]) && value.endsWith(value[0])) //quoted string
          return value.slice(1, -1);
        return value;
      }
    }
  }

  interface Segment {
    start: number;
    end: number;
    isString: boolean;
    text: string;
  }

  // Split this one line into string and non-string segments.
  const segments: Segment[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      const start = i;
      i++;
      while (i < line.length) {
        if (line[i] === "\\" && i + 1 < line.length) {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      segments.push({ start, end: i, isString: true, text: line.slice(start, i) });
    } else {
      const start = i;
      while (i < line.length && line[i] !== "'" && line[i] !== '"' && line[i] !== "`")
        i++;
      segments.push({ start, end: i, isString: false, text: line.slice(start, i) });
    }
  }

  let cursor = where.position.character;
  if (cursor < 0)
    cursor = 0;
  if (cursor > line.length)
    cursor = line.length;

  let segment = segments.find(_ => cursor >= _.start && cursor < _.end);
  if (!segment && cursor === line.length)
    segment = segments[segments.length - 1];

  if (!segment)
    return "";

  if (segment.isString)
    return segment.text.substring(1, segment.text.length - 1); //strip quotes (TODO decode backslasehs, eg JSON.parse?)

  const localPos = cursor - segment.start;
  const tokenmatcher = /[a-zA-Z0-9_]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenmatcher.exec(segment.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if ((localPos >= start && localPos < end) || localPos === end)
      return match[0];
  }

  return "";
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

export async function getDefinitions(docs: DocumentsLike, e: TextDocumentPositionParams): Promise<Definition | null> {
  const keyword = getKeywordOrTextAt(docs, e);
  console.log("Got definitionRequest for", keyword);

  //Does this look like a resource path?
  if (keyword.includes('.ts') || keyword.includes('.tsx') || keyword.includes('.whlib')) {
    const [, file, symbol] = keyword.match(/^([^#]+)(?:[#](.*))?$/) || [];
    const finallocation = new URL(isAbsoluteResource(file) ? `file://${toFSPath(file)}` : file, e.textDocument.uri);
    // console.log(`Resolving ${file} relative to ${e.textDocument.uri}, final ${finallocation}`);

    try {
      const text = readFileSync(finallocation.pathname, 'utf8');
      // Search for where symbolText is defined in the file
      // Example regex matching: class SymbolName or const SymbolName
      // const regex = new RegExp(`\\b(class| function|const| let |var| interface | type) \\s + ${ symbolText } \\b`);
      const regex = new RegExp(`\\b${symbol}\\b`, 'i');
      const match = regex.exec(text);

      if (match) {
        // Convert character index to line and character position
        //const targetPosition = tsDocument.positionAt(match.index);
        const lineNumber = text.slice(0, match.index).split('\n').length - 1;
        const colNumber = match.index - text.lastIndexOf('\n', match.index) - 1;
        const targetPosition = { line: lineNumber, character: colNumber };
        return { uri: "file://" + finallocation.pathname, range: { start: targetPosition, end: { line: targetPosition.line, character: targetPosition.character + match[0].length - 1 } } };
      }
      return { uri: "file://" + finallocation.pathname, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    } catch (exc) {
      console.log(`Failed to find symbol in ${finallocation.pathname}`, exc);
    }
  }

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
  return locations.length ? locations.length === 1 ? locations[0] : locations : null;
}

export async function getHover(docs: DocumentsLike, e: TextDocumentPositionParams, acceptMarkdown: boolean): Promise<Hover | null> {
  const keyword = getKeywordOrTextAt(docs, e);
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
      } else if (stack.filename.startsWith("@webhare/")) {
        stack.filename = backendConfig.installationRoot + "jssdk/" + stack.filename.substring(9);
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
