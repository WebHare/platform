/* Definitions for our custom language server requests, shared as type definitions to external users */

import type { TextDocumentIdentifier } from "vscode-languageserver-types";

// getStackTrace response
export interface StackTraceResponse {
  errors: StackTraceError[];
}

// One stack trace entry
export interface StackTraceError {
  date: Date;
  guid: string;
  groupid: string;
  stack: StackTraceItem[];
}

// Stack trace item (the first item of a trace contains the error message,
// subsequent items contain calling functions)
interface StackTraceItem {
  message?: string;
  func?: string;
  filename: string;
  line: number;
  col: number;
  editorpath: string;
  primary: boolean;
}

// Parameters for the getStackTrace call
export interface StackTraceParams {
  textDocument: TextDocumentIdentifier;
  lastGuid?: string;
}

export interface WHServerInitializeResult { //sent during LSP connection
  whServerInfo: {
    dataRoot: string;
  };
}
