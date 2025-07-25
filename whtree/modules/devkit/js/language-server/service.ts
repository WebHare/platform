/* Editor command handlers */

import type {
  CodeAction,
  CodeActionParams,
  Command,
  Definition,
  DocumentFormattingParams,
  ExecuteCommandParams,
  Hover,
  TextDocumentPositionParams,
  TextEdit,
  WorkDoneProgressServerReporter,
  TextDocumentChangeEvent,
  WorkspaceEdit,
} from "vscode-languageserver";
import type { StackTraceParams, StackTraceResponse } from "@webhare/lsp-types";

import { connection, connectionConfig, documents } from "./connection";

import { toFSPath, toResourcePath } from "@webhare/services";
import { readFile } from "node:fs/promises";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { doExecuteCommand, doReformat, doStackTraceRequest, getCodeActions, getDefinitions, getHover } from "./lsp-services";
import { DiagnosticsProcessor } from "./lsp-validation";


const processor = new DiagnosticsProcessor(documents, (uri, diagnostics) => {
  void connection.sendDiagnostics({ uri, diagnostics });
});

export async function didChangeContent(e: TextDocumentChangeEvent<TextDocument>) {
  await processor.update(e.document.uri);
}

export async function definitionRequest(e: TextDocumentPositionParams): Promise<Definition> {
  return getDefinitions(documents, e);
}

export async function hoverRequest(e: TextDocumentPositionParams): Promise<Hover | null> {
  const acceptMarkdown = connectionConfig.capabilities?.textDocument?.hover?.contentFormat?.includes("markdown") || false;
  return getHover(documents, e, acceptMarkdown);
}

export async function formattingRequest(params: DocumentFormattingParams): Promise<TextEdit[] | null> {
  const doc = documents.get(params.textDocument.uri);
  if (!doc)
    return null;

  const wd = await beginWorkDoneProgress("Formatting document...");
  const result = await doReformat(doc, params.options);
  wd?.done();
  return result;
}

export async function codeActionRequest(params: CodeActionParams): Promise<Array<Command | CodeAction>> {
  return await getCodeActions(params);
}

export async function executeCommandRequest(params: ExecuteCommandParams): Promise<void> {
  console.log(`doExecuteCommand ${params.command}`, params.arguments);
  const edits = await doExecuteCommand(documents, params);
  if ((edits as { error: string })?.error) {
    connection.window.showErrorMessage((edits as { error: string }).error);
    return;
  }
  // console.dir(edits, { depth: 10 });
  if (edits)
    await connection.workspace.applyEdit(edits as WorkspaceEdit);

  return;
}

export async function stackTraceRequest(params: StackTraceParams): Promise<StackTraceResponse | null> {
  return await doStackTraceRequest(params.lastGuid || null);
}

export async function toResourcePathRequest(params: string): Promise<string | null> {
  return toResourcePath(params, { allowUnmatched: true });
}

export async function toFSPathRequest(params: string): Promise<string | null> {
  return toFSPath(params, { allowUnmatched: true });
}

export async function webHareResourceRequest(params: string): Promise<string | null> {
  const path = toFSPath(params, { allowUnmatched: true });
  return path ? readFile(path, 'utf-8') : null;
}

async function beginWorkDoneProgress(message: string): Promise<WorkDoneProgressServerReporter | null> {
  if (!connectionConfig.capabilities?.window?.workDoneProgress) {
    return null;
  }
  const wd = await connection.window.createWorkDoneProgress();
  wd.begin(message);
  return wd;
}
